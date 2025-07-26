import express from 'express';
import cors from 'cors';
import session from 'express-session';

try {
    const app = express();
    const PORT = 3001;

    app.use(cors({
      origin: ['http://localhost:3000', 'http://localhost:5173'], 
      credentials: true,
    }));
    app.use(express.json());
    app.use(session({
        secret: 'un-secreto-muy-seguro-para-gestorpro',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, 
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 
        }
    }));

    let DB = {
        users: {
            "admin01": { id: "admin01", email: "admin@gestorpro.com", password: "password123", role: 'Admin', orgId: 'org01' },
            "tenant01": { id: "tenant01", email: "inquilino@correo.com", password: "password123", role: 'Tenant', orgId: 'org01', tenantDocId: 't01' }
        },
        organizations: {
            "org01": {
                properties: [ { id: "p01", name: 'Apartamento 101', type: 'Residencial', address: 'Av. Sol 123, Miraflores', status: 'Alquilado' }, { id: "p02", name: 'Oficina 205', type: 'Comercial', address: 'Jr. Unión 456, Centro', status: 'Disponible' }, ],
                tenants: [ { id: 't01', name: 'Carlos Gomez', email: 'carlos.gomez@email.com', phone: '987654321' }, { id: 't02', name: 'Ana Fernandez', email: 'ana.fernandez@email.com', phone: '912345678' } ],
                rentals: [ { id: 'r01', propertyId: 'p01', tenantId: 't01', startDate: '2024-01-01', endDate: '2025-12-31', rentAmount: 1500, status: 'Activo' }, ],
                payments: [ { id: 'pay01', rentalId: 'r01', amount: 1500, paymentDate: '2025-06-05', concept: 'Pago de Alquiler Junio 2025', status: 'Pagado' } ],
                maintenance: [ { id: 'm01', propertyId: 'p01', description: 'Fuga en el grifo de la cocina', status: 'Completado', reportedBy: 'tenant01', createdAt: new Date().toISOString() } ],
                expenses: [ { id: 'e01', propertyId: 'p01', amount: 200, date: '2025-06-10', description: 'Reparación de grifería', category: 'Reparación' } ],
                invitations: [ {id: 'inv01', email: 'nuevo.gestor@correo.com', role: 'Gestor', status: 'pendiente'} ]
            }
        }
    };

    const generateId = (prefix = 'id') => `${prefix}_${new Date().getTime()}`;

    // --- NUEVA RUTA DE REGISTRO ---
    app.post('/api/register', (req, res) => {
        const { email, password } = req.body;
        if (Object.values(DB.users).find(u => u.email === email)) {
            return res.status(409).json({ message: 'El correo electrónico ya está en uso.' });
        }

        const newUserId = generateId('user');
        const newOrgId = generateId('org');

        const newUser = {
            id: newUserId,
            email,
            password, // En una app real, esto debería estar hasheado
            role: 'Admin',
            orgId: newOrgId
        };
        DB.users[newUserId] = newUser;
        
        // Crear una organización vacía para el nuevo usuario
        DB.organizations[newOrgId] = {
            properties: [], tenants: [], rentals: [], payments: [], maintenance: [], expenses: [], invitations: []
        };
        
        console.log(`Nuevo usuario registrado: ${email} con Org ID: ${newOrgId}`);
        
        // Iniciar sesión automáticamente después del registro
        req.session.user = newUser;
        res.status(201).json(newUser);
    });

    app.post('/api/login', (req, res) => {
        const { email, password } = req.body;
        const user = Object.values(DB.users).find(u => u.email === email && u.password === password);
        if (user) {
            req.session.user = user;
            res.status(200).json(user);
        } else {
            res.status(401).json({ message: 'Credenciales inválidas.' });
        }
    });

    app.post('/api/logout', (req, res) => {
        req.session.destroy(err => {
            if (err) return res.status(500).json({ message: 'No se pudo cerrar la sesión.' });
            res.clearCookie('connect.sid');
            res.status(200).json({ message: 'Sesión cerrada exitosamente.' });
        });
    });

    app.get('/api/session', (req, res) => {
        if (req.session.user) {
            res.status(200).json({ user: req.session.user });
        } else {
            res.status(401).json({ message: 'No hay sesión activa.' });
        }
    });

    app.get('/api/data/:orgId', (req, res) => {
        if (!req.session.user || req.session.user.orgId !== req.params.orgId) return res.status(403).json({ message: 'Acceso no autorizado.' });
        const orgData = DB.organizations[req.params.orgId];
        if (orgData) {
            res.status(200).json(orgData);
        } else {
            res.status(404).json({ message: 'Organización no encontrada.' });
        }
    });

    const collections = ['properties', 'tenants', 'rentals', 'payments', 'maintenance', 'expenses', 'invitations'];
    collections.forEach(collectionName => {
        const endpoint = collectionName;
        
        app.post(`/api/:orgId/${endpoint}`, (req, res) => {
            if (!req.session.user || req.session.user.orgId !== req.params.orgId) return res.status(403).json({ message: 'Acceso no autorizado.' });
            const { orgId } = req.params;
            const newItem = { ...req.body, id: generateId(), createdAt: new Date().toISOString() };
            if (collectionName === 'invitations') newItem.status = 'pendiente';
            DB.organizations[orgId][collectionName].push(newItem);
            res.status(201).json(newItem);
        });

        app.put(`/api/:orgId/${endpoint}/:id`, (req, res) => {
            if (!req.session.user || req.session.user.orgId !== req.params.orgId) return res.status(403).json({ message: 'Acceso no autorizado.' });
            const { orgId, id } = req.params;
            const index = DB.organizations[orgId][collectionName].findIndex(item => item.id === id);
            if (index > -1) {
                DB.organizations[orgId][collectionName][index] = { ...DB.organizations[orgId][collectionName][index], ...req.body };
                res.status(200).json(DB.organizations[orgId][collectionName][index]);
            } else {
                res.status(404).json({ message: 'Elemento no encontrado.' });
            }
        });

        app.delete(`/api/:orgId/${endpoint}/:id`, (req, res) => {
             if (!req.session.user || req.session.user.orgId !== req.params.orgId) return res.status(403).json({ message: 'Acceso no autorizado.' });
            const { orgId, id } = req.params;
            DB.organizations[orgId][collectionName] = DB.organizations[orgId][collectionName].filter(item => item.id !== id);
            res.status(204).send();
        });
    });

    // --- ENDPOINT DE IA MEJORADO ---
    app.post('/api/ai/generate', (req, res) => {
        if (!req.session.user) return res.status(403).json({ message: 'Acceso no autorizado.' });
        const { type, context } = req.body;
        let response = '';

        if (type === 'paymentConcept') {
            const { tenantName, date } = context;
            const month = new Date(date).toLocaleString('es-PE', { month: 'long', year: 'numeric' });
            response = `Pago de alquiler de ${tenantName} para el mes de ${month}.`;
        } else if (type === 'maintenancePlan') {
            response = `**Plan de Acción para:** "${context.description}"\n\n**1. Prioridad:** Alta.\n\n**2. Pasos:**\n   - Inspeccionar el área.\n   - Adquirir materiales necesarios.\n   - Realizar la reparación.\n   - Verificar funcionamiento.\n\n**3. Materiales:**\n   - (Determinar después de la inspección).`;
        } else {
            response = `No se puede generar una respuesta de IA para el tipo "${type}".`;
        }
        
        res.status(200).json({ response });
    });

    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo exitosamente en http://localhost:${PORT}`);
    });

} catch (error) {
    console.error("\n==== ERROR FATAL AL INICIAR EL SERVIDOR ====");
    console.error(error);
    process.exit(1);
}
