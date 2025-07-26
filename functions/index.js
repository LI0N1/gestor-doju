// functions/index.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios");
const twilio = require("twilio");

admin.initializeApp();

// --- Función de ayuda para formatear fechas para mensajes de usuario ---
function formatDateForMessage(dateString) {
    // Interpreta la fecha como UTC para evitar desfases al formatear
    const date = new Date(`${dateString}T12:00:00Z`);
    if (isNaN(date)) return dateString;
    
    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
    };
    return new Intl.DateTimeFormat('es-ES', options).format(date);
}

// --- Función de ayuda para formatear números de teléfono ---
function formatPhoneNumber(phone) {
    let cleanPhone = String(phone).replace(/\s/g, ''); // Elimina espacios
    if (cleanPhone.length === 9 &&!cleanPhone.startsWith('+')) {
        return `+51${cleanPhone}`; // Asume código de Perú
    }
    return cleanPhone; // Devuelve el número si ya tiene formato internacional
}

// --- CLOUD FUNCTION: Consultar DNI ---
exports.consultarDNI = onCall(
  {
    region: "us-central1",
    // secrets: [], // No secrets used for this function
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "El usuario debe estar autenticado.");
    }
    const apiToken = process.env.API_TOKEN_DNI;
    if (!apiToken) {
      console.error("El secreto 'API_TOKEN_DNI' no está configurado.");
      throw new HttpsError("internal", "Error de configuración del servidor.");
    }
    const dni = request.data.dni;
    if (!/^\d{8}$/.test(dni)) {
      throw new HttpsError("invalid-argument", "El DNI debe tener 8 dígitos.");
    }
    const apiUrl = `https://api.apis.net.pe/v1/dni?numero=${dni}`;
    try {
      const response = await axios.get(apiUrl, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      if (response.data && response.data.nombres) {
        const { nombres, apellidoPaterno, apellidoMaterno } = response.data;
        const nombreCompleto = `${nombres} ${apellidoPaterno} ${apellidoMaterno}`.trim();
        return { nombreCompleto };
      } else {
        throw new HttpsError("not-found", "No se encontró información para el DNI.");
      }
    } catch (error) {
      console.error("Error en API de DNI:", error.response? `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}` : error.message);
      throw new HttpsError("internal", "Error al consultar el servicio de DNI.");
    }
  }
);

// --- CLOUD FUNCTION: Enviar Mensaje de WhatsApp Manualmente ---
exports.sendWhatsApp = onCall(
  {
    region: "us-central1",
    // secrets: [], // No secrets used for this function
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "El usuario debe estar autenticado.");
    }
    const { phoneNumber, message } = request.data;
    if (!phoneNumber ||!message) {
      throw new HttpsError("invalid-argument", "El número y el mensaje son requeridos.");
    }
    const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const formattedNumber = formatPhoneNumber(phoneNumber);
    try {
      await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `whatsapp:${formattedNumber}`,
        body: message,
      });
      return { success: true, message: "Mensaje enviado exitosamente." };
    } catch (error) {
      console.error("Error al enviar WhatsApp:", error);
      throw new HttpsError("internal", "No se pudo enviar el mensaje de WhatsApp.");
    }
  }
);

// --- CLOUD FUNCTION: Tareas Programadas Diarias (LÓGICA OPTIMIZADA Y CORREGIDA) ---
exports.dailyChecks = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "America/Lima",
    //    secrets:, // CORREGIDO
  },
  async (event) => {
    const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    const db = admin.firestore();
    const allPromises = []; // CORREGIDO

    // --- Lógica de Fechas Confiable ---
    // Usamos toLocaleDateString con el local 'sv-SE' (Suecia) que convenientemente
    // nos da el formato YYYY-MM-DD respetando la zona horaria.
    const today = new Date();
    const todayString = today.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });

    const organizationsSnapshot = await db.collection('organizations').get();

    for (const orgDoc of organizationsSnapshot.docs) {
        const orgId = orgDoc.id;

        const sendReminder = async (tenantId, message) => {
            try {
                const tenantDoc = await db.doc(`organizations/${orgId}/tenants/${tenantId}`).get();
                if (tenantDoc.exists && tenantDoc.data().phone) {
                    const formattedNumber = formatPhoneNumber(tenantDoc.data().phone);
                    const promise = client.messages.create({
                        from: twilioPhoneNumber,
                        to: `whatsapp:${formattedNumber}`,
                        body: message
                    }).catch(err => console.error(`Fallo al enviar a ${formattedNumber}:`, err.message));
                    allPromises.push(promise);
                } else {
                    console.log(`Inquilino ${tenantId} no encontrado o sin teléfono.`);
                }
            } catch (error) {
                console.error(`Error al obtener inquilino ${tenantId}:`, error.message);
            }
        };

        // --- 1. Procesar Pagos Vencidos ---
        const overduePaymentsQuery = db.collection(`organizations/${orgId}/payments`)
           .where('status', '==', 'Pendiente')
           .where('paymentDate', '<', todayString);
        const overdueSnapshot = await overduePaymentsQuery.get();
        for (const doc of overdueSnapshot.docs) {
            const payment = doc.data();
            const message = `Recordatorio: Tienes un pago vencido por "${payment.concept}" de S/ ${payment.amount}.`;
            await sendReminder(payment.tenantId, message);
        }

        // --- 2. Procesar Pagos Próximos ---
        const fourDaysFromNow = new Date(today);
        fourDaysFromNow.setDate(today.getDate() + 4);
        const fourDaysFromNowString = fourDaysFromNow.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
        
        const upcomingPaymentsQuery = db.collection(`organizations/${orgId}/payments`)
           .where('status', '==', 'Pendiente')
           .where('paymentDate', '>=', todayString)
           .where('paymentDate', '<', fourDaysFromNowString);
        const upcomingSnapshot = await upcomingPaymentsQuery.get();
        for (const doc of upcomingSnapshot.docs) {
            const payment = doc.data();
            const paymentDate = new Date(`${payment.paymentDate}T12:00:00Z`);
            const todayDate = new Date(`${todayString}T12:00:00Z`);
            const diffTime = paymentDate.getTime() - todayDate.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            let message;
            if (diffDays === 0) {
                message = `Recordatorio Amistoso: Tu pago por "${payment.concept}" de S/ ${payment.amount} vence HOY.`;
            } else {
                message = `Recordatorio Amistoso: Tu pago por "${payment.concept}" de S/ ${payment.amount} vence en ${diffDays} día(s).`;
            }
            await sendReminder(payment.tenantId, message);
        }

        // --- 3. Procesar Contratos por Vencer ---
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        const thirtyDaysFromNowString = thirtyDaysFromNow.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });

        const contractsQuery = db.collection(`organizations/${orgId}/rentals`)
           .where('status', '==', 'Activo')
           .where('endDate', '>=', todayString)
           .where('endDate', '<=', thirtyDaysFromNowString);
        
        const expiringContracts = await contractsQuery.get(); 
        for (const doc of expiringContracts.docs) {
            const contract = doc.data();
            const message = `Alerta: Tu contrato de alquiler está a punto de vencer el ${formatDateForMessage(contract.endDate)}. Por favor, contacta a la administración.`;
            await sendReminder(contract.tenantId, message);
        }
    }
    
    await Promise.all(allPromises);
    console.log("Verificaciones diarias completadas.");
    return null;
  }
);