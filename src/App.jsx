import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from 'react';
import { Home, Building2, Users, FileText, DollarSign, Plus, Edit, Trash2, X, Sparkles, Wrench, BarChart2, BrainCircuit, Send, Search, LogOut, ShieldCheck, TrendingDown, FileSignature, Users2, AlertTriangle, Bell, KeyRound, Download, Eye, UploadCloud, CheckCircle, Clock, ArrowRight, Receipt, FileCheck, Copy, FilePlus, ArrowLeft, FileDown, Bot, Info, Camera } from 'lucide-react';
import { marked } from 'marked';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// --- IMPORTACIONES DE FIREBASE ---
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, where, getDocs, writeBatch, orderBy, collectionGroup } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { getFunctions, httpsCallable } from 'firebase/functions';

// --- CONTEXTO PARA NOTIFICACIONES Y LIBRERÍAS ---
const LibsContext = createContext({ libsLoaded: false });
const ToastContext = createContext({ showToast: () => {} });
const NotificationContext = createContext({ showNotification: () => Promise.resolve(false) });

// --- CONFIGURACIÓN E INICIALIZACIÓN DE FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyArzwnslCqhdk4WNREhckarKcQaywxI2jk",
    authDomain: "gestor-doju.firebaseapp.com",
    projectId: "gestor-doju",
    storageBucket: "gestor-doju.firebasestorage.app",
    messagingSenderId: "933106500168",
    appId: "1:933106500168:web:3aeb61808e1d6d8dc04e7d",
    measurementId: "G-SHXKW69ZBB"
};

let app;
try {
    app = initializeApp(firebaseConfig);
} catch (error) {
    console.error("Error inicializando Firebase, es posible que ya exista una instancia.", error);
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// --- FUNCIÓN DE REGISTRO DE AUDITORÍA ---
const addLogEntry = async (orgId, user, action, section, details) => {
    if (!orgId || !user) {
        console.error("No se puede registrar el log: falta orgId o usuario.");
        return;
    }
    try {
        await addDoc(collection(db, `organizations/${orgId}/logs`), {
            timestamp: new Date().toISOString(),
            userEmail: user.email,
            userId: user.uid,
            action,
            section,
            details: details || {}
        });
    } catch (error) {
        console.error("Error al escribir en el log de auditoría:", error);
    }
};

// --- UTILITY HELPERS ---
const findById = (arr = [], id) => arr.find(item => item.id === id) || {};
const renderMarkdown = (text) => text ? marked.parse(text, { breaks: true, gfm: true }) : '';
const formatDate = (dateString, includeTime = false) => {
    if (!dateString) return 'N/A';
    const date = new Date(`${dateString}T00:00:00Z`);
    if (isNaN(date)) return 'Fecha inválida';

    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
    };

    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
        options.second = '2-digit';
    }
    
    return new Intl.DateTimeFormat('es-ES', options).format(date);
};

// --- API DE DNI ---
const consultarDNI = async (dni) => {
    if (!dni || dni.length !== 8 || isNaN(dni)) {
        return { success: false, message: "Por favor, ingrese un DNI válido de 8 dígitos." };
    }
    try {
        const apiUrl = `https://api.apis.net.pe/v1/dni?numero=${dni}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`;
        
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Error del servidor: ${response.status}`);
        }

        const data = await response.json();
        
        if (data && data.nombres) {
             const fullName = `${data.nombres} ${data.apellidoPaterno} ${data.apellidoMaterno}`;
             return { success: true, data: { ...data, nombreCompleto: fullName } };
        } else {
             return { success: false, message: data.message || "No se encontraron datos para el DNI consultado." };
        }
    } catch (error) {
        console.error("Error al consultar DNI:", error);
        return { success: false, message: `Error al conectar con el servicio de DNI: ${error.message}` };
    }
};

// --- Función unificada para llamar a Gemini ---
const callAIGenerator = async (prompt, apiKey, context = {}, jsonSchema = null) => {
    if (!apiKey) {
        return { success: false, data: "Error: La clave de API de Gemini no ha sido configurada. Por favor, ve a la página de 'Ajustes' para añadirla." };
    }

    const fullPrompt = `${prompt}\n\nContexto en JSON para tu análisis:\n${JSON.stringify(context, null, 2)}`;
    
    const payload = {
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    };

    if (jsonSchema) {
        payload.generationConfig = {
            responseMimeType: "application/json",
            responseSchema: jsonSchema,
        };
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ error: { message: "Respuesta de error no válida" } }));
            return { success: false, data: `Error al contactar la IA: ${errorBody.error.message}.` };
        }

        const result = await response.json();
        if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
            const text = result.candidates[0].content.parts[0].text;
            try {
                return { success: true, data: jsonSchema ? JSON.parse(text) : text };
            } catch(e) {
                console.error("Error al parsear JSON de la IA:", e);
                return { success: false, data: "La IA devolvió una respuesta JSON mal formada." };
            }
        } else {
            console.warn("Respuesta inesperada de la IA:", result);
            return { success: false, data: "La IA no pudo generar una respuesta. Por favor, intenta de nuevo." };
        }
    } catch (error) {
        return { success: false, data: "No se pudo conectar con el servicio de IA. Verifica tu conexión a internet." };
    }
};

// --- UI COMPONENTS ---
const Card = ({ children, className = '' }) => <div className={`bg-white border rounded-xl shadow-sm ${className}`}>{children}</div>;
const CardHeader = ({ children, className = '' }) => <div className={`p-4 md:p-5 border-b ${className}`}><div className="flex items-center gap-x-2">{children}</div></div>;
const CardContent = ({ children, className = '' }) => <div className={`p-4 md:p-5 ${className}`}>{children}</div>;
const CardTitle = ({ children, className = '' }) => <h3 className={`font-semibold text-lg text-gray-800 ${className}`}>{children}</h3>;
const Button = ({ children, onClick, className = '', variant = 'default', disabled = false, type = 'button' }) => {
    const variants = {
        default: 'bg-slate-900 text-white hover:bg-slate-800',
        destructive: 'bg-red-500 text-white hover:bg-red-600',
        outline: 'border border-slate-200 bg-transparent hover:bg-slate-100 text-slate-800',
        ghost: 'hover:bg-slate-100 text-slate-800',
        success: 'bg-green-600 text-white hover:bg-green-700'
    };
    return <button onClick={onClick} disabled={disabled} type={type} className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none px-4 py-2 ${variants[variant]} ${className}`}>{children}</button>;
};
const Input = (props) => <input {...props} className={`flex h-10 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${props.className}`} />;
const Textarea = (props) => <textarea {...props} className={`flex min-h-[80px] w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${props.className}`} />;
const Select = ({ children, ...props }) => <select {...props} className={`flex h-10 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${props.className}`}>{children}</select>;
const Modal = ({ isOpen, onClose, title, children, footerContent, size = 'lg' }) => {
    if (!isOpen) return null;
    const sizeClasses = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '4xl': 'max-w-4xl', '6xl': 'max-w-6xl' };
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4" onClick={onClose}>
            <div className={`bg-white rounded-xl shadow-lg w-full ${sizeClasses[size]}`} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full w-8 h-8">
                        <X size={16} />
                    </Button>
                </div>
                <div className="p-4 max-h-[70vh] overflow-y-auto">{children}</div>
                {footerContent && (
                    <div className="p-4 border-t bg-gray-50 rounded-b-xl">
                        {footerContent}
                    </div>
                )}
            </div>
        </div>
    );
};
const Spinner = ({ className = '' }) => <div className={`animate-spin rounded-full h-5 w-5 border-b-2 border-slate-900 ${className}`}></div>;
const FullPageLoader = ({ message }) => (<div className="flex flex-col justify-center items-center h-screen w-full gap-4"><Spinner className="h-8 w-8" /><p className="text-gray-500">{message}</p></div>);
const EmptyState = ({ icon: Icon, title, message }) => (<div className="text-center py-12 text-gray-500"><Icon className="mx-auto h-12 w-12 text-gray-400" /><h3 className="mt-2 text-lg font-medium text-gray-900">{title}</h3><p className="mt-1 text-sm">{message}</p></div>);

// --- Componente para subir recibos de servicios ---
const ServiceReceiptManager = ({ isOpen, onClose, tenant, orgId, userProfile }) => {
    const [receipts, setReceipts] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    const tenantRef = useMemo(() => {
        if (!orgId || !tenant?.id) return null;
        return doc(db, `organizations/${orgId}/tenants`, tenant.id);
    }, [orgId, tenant]);

    useEffect(() => {
        if (!tenantRef) return;
        const receiptsCollectionRef = collection(tenantRef, 'serviceReceipts');
        const q = query(receiptsCollectionRef, orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setReceipts(data);
        });
        return () => unsubscribe();
    }, [tenantRef]);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !tenantRef) return;

        setIsUploading(true);
        const filePath = `serviceReceipts/${tenant.id}/${Date.now()}_${file.name}`;
        const fileStorageRef = storageRef(storage, filePath);
        const uploadTask = uploadBytesResumable(fileStorageRef, file);

        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setUploadProgress(progress);
            },
            (error) => {
                console.error("Error al subir recibo:", error);
                setIsUploading(false);
            },
            async () => {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                const docData = {
                    name: file.name,
                    url: downloadURL,
                    path: filePath,
                    createdAt: new Date().toISOString(),
                    uploadedBy: userProfile.email
                };
                await addDoc(collection(tenantRef, 'serviceReceipts'), docData);
                await addLogEntry(orgId, userProfile, `UPLOAD_SERVICE_RECEIPT`, 'Inquilinos', { tenantId: tenant.id, documentName: file.name });
                setIsUploading(false);
                setUploadProgress(0);
            }
        );
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Recibos de Servicios de ${tenant?.name || ''}`} size="2xl">
            <div>
                <div className="mb-4 p-4 border-2 border-dashed rounded-lg text-center">
                    <label htmlFor="receipt-upload" className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                        <UploadCloud className="mx-auto h-10 w-10 text-gray-400 mb-2" />
                        <span>Selecciona un recibo para subir</span>
                        <input id="receipt-upload" name="receipt-upload" type="file" className="sr-only" onChange={handleFileUpload} disabled={isUploading} />
                    </label>
                </div>

                {isUploading && (
                    <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                )}

                <h4 className="font-semibold text-gray-700 mb-2">Recibos existentes:</h4>
                {receipts.length > 0 ? (
                    <ul className="divide-y divide-gray-200">
                        {receipts.map(receipt => (
                            <li key={receipt.id} className="py-3 flex items-center justify-between">
                                <span className="text-sm text-gray-800 truncate">{receipt.name}</span>
                                <div className="flex items-center gap-2">
                                    <a href={receipt.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center p-2 text-blue-600 hover:bg-blue-50 rounded-full" title="Ver archivo">
                                        <Eye size={16} />
                                    </a>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-500 text-center py-4">No hay recibos para este inquilino.</p>
                )}
            </div>
        </Modal>
    );
};

// --- Componente de Autenticación con Firebase ---
const AuthComponent = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleAuth = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            setError(err.message.includes("auth/invalid-credential") ? "Credenciales incorrectas." : "Ocurrió un error.");
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center h-screen bg-gray-100">
            <Card className="w-full max-w-sm">
                <CardHeader><CardTitle>Iniciar Sesión</CardTitle></CardHeader>
                <CardContent>
                    <p className="text-sm text-gray-500 mb-4">Acceso exclusivo para usuarios registrados</p>
                    <form onSubmit={handleAuth} className="space-y-4">
                        <Input type="email" placeholder="Correo Electrónico" value={email} onChange={e => setEmail(e.target.value)} required />
                        <Input type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} required />
                        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading ? <Spinner /> : 'Ingresar'}
                        </Button>
                    </form>
                    <div className="mt-4 text-center">
                        <p className="text-sm text-gray-600">¿Problemas para acceder? Contacta al administrador</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

// --- Componente de Alertas ---
const Notifications = ({ rentals = [], payments = [], tenants = [], properties = [] }) => {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const expiringContracts = rentals.filter(r => {
        const endDate = new Date(r.endDate);
        return r.status === 'Activo' && endDate <= thirtyDaysFromNow && endDate >= today;
    });

    const overduePayments = payments.filter(p => {
        const paymentDate = new Date(p.paymentDate);
        return p.status === 'Pendiente' && paymentDate < today;
    });

    if (expiringContracts.length === 0 && overduePayments.length === 0) {
        return null;
    }

    return (
        <Card className="mb-6 border-l-4 border-yellow-400 bg-yellow-50">
            <CardHeader className="bg-yellow-100">
                <Bell className="text-yellow-600" />
                <CardTitle>Alertas Requieren Atención</CardTitle>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2 text-sm">
                    {expiringContracts.map(r => {
                        const tenantName = findById(tenants, r.tenantId)?.name || 'N/A';
                        const propertyName = findById(properties, r.propertyId)?.name || 'N/A';
                        return (
                            <li key={r.id} className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                                <span>El contrato de <strong>{tenantName}</strong> en <strong>{propertyName}</strong> vence pronto ({formatDate(r.endDate)}).</span>
                            </li>
                        );
                    })}
                    {overduePayments.map(p => {
                        const rental = findById(rentals, p.rentalId);
                        const tenantName = findById(tenants, rental?.tenantId)?.name || 'N/A';
                        return (
                            <li key={p.id} className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                                <span>Pago de <strong>{tenantName}</strong> por el concepto "{p.concept}" está vencido.</span>
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
        </Card>
    );
};

// --- Gestor de Documentos ---
const DocumentManager = ({ isOpen, onClose, item, collectionName, orgId, userProfile }) => {
    const [documents, setDocuments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const showNotification = useContext(NotificationContext);

    const itemRef = useMemo(() => {
        if (!orgId || !collectionName || !item?.id) return null;
        return doc(db, `organizations/${orgId}/${collectionName}`, item.id);
    }, [orgId, collectionName, item]);

    useEffect(() => {
        if (!itemRef) return;
        const docsCollectionRef = collection(itemRef, 'documents');
        const q = query(docsCollectionRef);
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const docsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setDocuments(docsData);
        });
        return () => unsubscribe();
    }, [itemRef]);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !itemRef) return;

        setIsUploading(true);
        const filePath = `documents/${collectionName}/${item.id}/${Date.now()}_${file.name}`;
        const fileStorageRef = storageRef(storage, filePath);
        const uploadTask = uploadBytesResumable(fileStorageRef, file);

        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                setUploadProgress(progress);
            },
            (error) => {
                console.error("Error al subir archivo:", error);
                setIsUploading(false);
            },
            async () => {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                const docData = {
                    name: file.name,
                    url: downloadURL,
                    path: filePath,
                    createdAt: new Date().toISOString()
                };
                await addDoc(collection(itemRef, 'documents'), docData);
                await addLogEntry(orgId, userProfile, `UPLOAD_DOCUMENT`, collectionName, { parentId: item.id, document: docData });
                setIsUploading(false);
                setUploadProgress(0);
            }
        );
    };

    const handleFileDelete = async (docToDelete) => {
        const confirmed = await showNotification({
            title: 'Confirmar Eliminación',
            message: `¿Seguro que quieres eliminar "${docToDelete.name}"?`,
            confirmText: 'Sí, eliminar',
            isDestructive: true
        });
        if (!confirmed) return;
        try {
            const fileStorageRef = storageRef(storage, docToDelete.path);
            await deleteObject(fileStorageRef);
            const docRef = doc(itemRef, 'documents', docToDelete.id);
            await deleteDoc(docRef);
            await addLogEntry(orgId, userProfile, `DELETE_DOCUMENT`, collectionName, { parentId: item.id, documentName: docToDelete.name });
        } catch (error) {
            console.error("Error al eliminar el archivo:", error);
            if(error.code === 'storage/object-not-found') {
                 const docRef = doc(itemRef, 'documents', docToDelete.id);
                 await deleteDoc(docRef);
                 await addLogEntry(orgId, userProfile, `DELETE_DOCUMENT_RECORD`, collectionName, { parentId: item.id, documentName: docToDelete.name, reason: "Archivo no encontrado en Storage." });
            }
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Documentos de ${item?.name || ''}`} size="2xl">
            <div>
                <div className="mb-4 p-4 border-2 border-dashed rounded-lg text-center">
                    <label htmlFor="file-upload" className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                        <UploadCloud className="mx-auto h-10 w-10 text-gray-400 mb-2" />
                        <span>Selecciona un archivo para subir</span>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileUpload} disabled={isUploading} />
                    </label>
                </div>

                {isUploading && (
                    <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                )}

                <h4 className="font-semibold text-gray-700 mb-2">Archivos existentes:</h4>
                {documents.length > 0 ? (
                    <ul className="divide-y divide-gray-200">
                        {documents.map(docItem => (
                            <li key={docItem.id} className="py-3 flex items-center justify-between">
                                <span className="text-sm text-gray-800 truncate">{docItem.name}</span>
                                <div className="flex items-center gap-2">
                                    <a href={docItem.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center p-2 text-blue-600 hover:bg-blue-50 rounded-full" title="Ver archivo">
                                        <Eye size={16} />
                                    </a>
                                    <button onClick={() => handleFileDelete(docItem)} className="inline-flex items-center justify-center p-2 text-red-600 hover:bg-red-50 rounded-full" title="Eliminar archivo">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-500 text-center py-4">No hay documentos para este elemento.</p>
                )}
            </div>
        </Modal>
    );
};

// --- Modal de Reporte Financiero ---
const FinancialReportModal = ({ isOpen, onClose, payments, expenses, properties, tenants, rentals }) => {
    const { libsLoaded } = useContext(LibsContext);
    const showNotification = useContext(NotificationContext);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const generateReport = () => {
        if (!startDate || !endDate) {
            showNotification({ title: "Error", message: "Por favor, selecciona un rango de fechas." });
            return;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const filteredPayments = payments.filter(p => {
            const pDate = new Date(p.paymentDate);
            return pDate >= start && pDate <= end && p.status !== 'Pendiente';
        });

        const filteredExpenses = expenses.filter(e => {
            const eDate = new Date(e.date);
            return eDate >= start && eDate <= end;
        });

        const totalIncome = filteredPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
        const totalExpenses = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
        const netProfit = totalIncome - totalExpenses;

        const doc = new window.jspdf.jsPDF();
        
        doc.setFontSize(18);
        doc.text("Reporte Financiero", 14, 22);
        doc.setFontSize(11);
        doc.text(`Periodo: ${formatDate(startDate)} - ${formatDate(endDate)}`, 14, 30);

        doc.setFontSize(12);
        doc.text("Resumen General", 14, 45);
        doc.autoTable({
            startY: 50,
            body: [
                ['Ingresos Totales:', `S/ ${totalIncome.toFixed(2)}`],
                ['Gastos Totales:', `S/ ${totalExpenses.toFixed(2)}`],
                ['Beneficio Neto:', `S/ ${netProfit.toFixed(2)}`],
            ],
            theme: 'striped',
            styles: { fontSize: 10 }
        });

        if (filteredPayments.length > 0) {
            doc.text("Detalle de Ingresos", 14, doc.autoTable.previous.finalY + 15);
            doc.autoTable({
                startY: doc.autoTable.previous.finalY + 20,
                head: [['Fecha', 'Inquilino', 'Propiedad', 'Concepto', 'Monto (S/)']],
                body: filteredPayments.map(p => {
                    const rental = findById(rentals, p.rentalId);
                    const tenant = findById(tenants, rental?.tenantId);
                    const property = findById(properties, rental?.propertyId);
                    return [
                        formatDate(p.paymentDate),
                        tenant?.name || 'N/A',
                        property?.name || 'N/A',
                        p.concept,
                        parseFloat(p.amount).toFixed(2)
                    ];
                }),
                theme: 'grid',
                headStyles: { fillColor: [41, 128, 185] },
            });
        }

        if (filteredExpenses.length > 0) {
            doc.text("Detalle de Gastos", 14, doc.autoTable.previous.finalY + 15);
            doc.autoTable({
                startY: doc.autoTable.previous.finalY + 20,
                head: [['Fecha', 'Propiedad', 'Categoría', 'Descripción', 'Monto (S/)']],
                body: filteredExpenses.map(e => [
                    formatDate(e.date),
                    findById(properties, e.propertyId)?.name || 'N/A',
                    e.category,
                    e.description,
                    parseFloat(e.amount).toFixed(2)
                ]),
                theme: 'grid',
                headStyles: { fillColor: [192, 57, 43] },
            });
        }
        
        doc.save(`reporte-financiero-${startDate}-a-${endDate}.pdf`);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Generar Reporte Financiero">
            <div className="space-y-4">
                <p>Selecciona el rango de fechas para el reporte.</p>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium">Desde</label>
                        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </div>
                    <div>
                        <label className="text-sm font-medium">Hasta</label>
                        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                    </div>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button onClick={generateReport} disabled={!libsLoaded}>
                        {!libsLoaded ? <><Spinner className="mr-2 h-4 w-4"/>Cargando...</> : 'Generar PDF'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

// --- Dashboard ---
const Dashboard = ({ appData, userProfile, organizationData }) => {
    const { payments = [], expenses = [], properties = [], rentals = [], tenants = [] } = appData || {};
    const [insights, setInsights] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);

    const getInsights = useCallback(async () => {
        setIsAiLoading(true);
        const prompt = "Actúa como un asesor inmobiliario experto. Analiza los siguientes datos de mi portafolio y proporciona un resumen conciso y 3 recomendaciones clave, con formato markdown, para mejorar la rentabilidad y gestión.";
        const context = {
            totalIngresos: (payments || []).reduce((acc, p) => acc + parseFloat(p.amount || 0), 0),
            totalGastos: (expenses || []).reduce((acc, e) => acc + parseFloat(e.amount || 0), 0),
            numeroPropiedades: (properties || []).length,
            propiedadesAlquiladas: (rentals || []).filter(r => r.status === 'Activo').length,
            propiedadesDisponibles: (properties || []).filter(p => p.status === 'Disponible').length,
        };
        const { success, data } = await callAIGenerator(prompt, organizationData?.geminiApiKey, context);
        if (success) {
            setInsights(data);
        } else {
            setInsights(data); // Show error message
        }
        setIsAiLoading(false);
    }, [payments, expenses, properties, rentals, organizationData]);

    const financialData = useMemo(() => [{ name: 'Ingresos', value: (payments || []).reduce((acc, p) => p.status === 'Pagado' || p.status === 'Verificado' ? acc + parseFloat(p.amount || 0) : acc, 0), color: '#10b981' }, { name: 'Gastos', value: (expenses || []).reduce((acc, e) => acc + parseFloat(e.amount || 0), 0), color: '#ef4444' }], [payments, expenses]);
    const propertyStatusData = useMemo(() => { const statuses = (properties || []).reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {}); return Object.keys(statuses).map(key => ({ name: key, value: statuses[key] })); }, [properties]);
    const COLORS = { 'Disponible': '#22c55e', 'Alquilado': '#3b82f6', 'Mantenimiento': '#f97316' };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">Panel Principal</h1>
                <Button onClick={() => setIsReportModalOpen(true)} variant="outline">
                    <BarChart2 className="mr-2 h-4 w-4" />
                    Generar Reporte Financiero
                </Button>
            </div>

            <Notifications rentals={rentals} payments={payments} tenants={tenants} properties={properties} />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card><CardHeader><CardTitle>Resumen Financiero</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={250}><BarChart data={financialData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip formatter={(value) => `S/ ${value.toFixed(2)}`} /><Bar dataKey="value" >{financialData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}</Bar></BarChart></ResponsiveContainer></CardContent></Card>
                <Card><CardHeader><CardTitle>Estado de Propiedades</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={propertyStatusData} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value" nameKey="name" label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>{propertyStatusData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[entry.name]} />)}</Pie><Tooltip formatter={(value, name) => [value, name]} /><Legend /></PieChart></ResponsiveContainer></CardContent></Card>
                <Card><CardHeader><CardTitle>Ocupación</CardTitle></CardHeader><CardContent className="text-center"><p className="text-6xl font-bold text-slate-800">{(properties || []).length > 0 ? Math.round(((rentals || []).filter(r => r.status === 'Activo').length / (properties || []).length) * 100) : 0}%</p><p className="text-gray-500 mt-2">{(rentals || []).filter(r => r.status === 'Activo').length} de {(properties || []).length} propiedades alquiladas</p></CardContent></Card>
            </div>
            <div className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Análisis y Recomendaciones con IA</CardTitle>
                        <Button onClick={getInsights} disabled={isAiLoading || !organizationData?.geminiApiKey} variant="outline" className="ml-auto">
                            <Sparkles className="mr-2 h-4 w-4" />
                            {isAiLoading ? 'Analizando...' : 'Generar Análisis'}
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {isAiLoading && <div className="flex justify-center p-8"><Spinner/></div>}
                        {insights && !isAiLoading && <div className="prose prose-sm max-w-full" dangerouslySetInnerHTML={{ __html: renderMarkdown(insights) }}></div>}
                        {!insights && !isAiLoading && (
                            !organizationData?.geminiApiKey ? 
                            <EmptyState icon={KeyRound} title="Configuración Requerida" message="Para usar esta función, añade tu clave de API de Gemini en la página de Ajustes." /> :
                            <EmptyState icon={BrainCircuit} title="Obtén un análisis" message="Haz clic en el botón para que la IA analice tus datos y te dé recomendaciones." />
                        )}
                    </CardContent>
                </Card>
            </div>
             <FinancialReportModal 
                isOpen={isReportModalOpen} 
                onClose={() => setIsReportModalOpen(false)}
                payments={appData.payments}
                expenses={appData.expenses}
                properties={appData.properties}
                tenants={appData.tenants}
                rentals={appData.rentals}
            />
        </div>
    );
};

// --- Portal de Inquilino Completo ---
const TenantPortal = ({ userProfile, onLogout, organizationData }) => {
    const [myRental, setMyRental] = useState(null);
    const [myProperty, setMyProperty] = useState(null);
    const [myPayments, setMyPayments] = useState([]);
    const [myMaintenance, setMyMaintenance] = useState([]);
    const [myTenantData, setMyTenantData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newMaintDesc, setNewMaintDesc] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [serviceReceipts, setServiceReceipts] = useState([]);
    const [isChatOpen, setIsChatOpen] = useState(false);

    const handleWhatsAppContact = () => {
        const managerPhone = organizationData?.managerPhoneNumber;
        if (managerPhone) {
            window.open(`https://wa.me/${managerPhone}`, '_blank');
        } else {
            alert("El número de contacto del gestor no está configurado.");
        }
    };

    useEffect(() => {
        if (!userProfile?.orgId || !userProfile?.tenantDocId) {
            setIsLoading(false);
            return;
        }
        
        const orgId = userProfile.orgId;
        const tenantId = userProfile.tenantDocId;
        let unsubscribers = [];
        
        const tenantRef = doc(db, `organizations/${orgId}/tenants`, tenantId);
        unsubscribers.push(onSnapshot(tenantRef, (docSnap) => {
            if (docSnap.exists()) setMyTenantData({ id: docSnap.id, ...docSnap.data() });
        }));

        const rentalQuery = query(collection(db, `organizations/${orgId}/rentals`), where("tenantId", "==", tenantId), where("status", "==", "Activo"));
        unsubscribers.push(onSnapshot(rentalQuery, (snapshot) => {
            if (!snapshot.empty) {
                const rentalData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
                setMyRental(rentalData);
            } else {
                setMyRental(null);
            }
            setIsLoading(false);
        }));

        const paymentsQuery = query(collection(db, `organizations/${orgId}/payments`), where("tenantId", "==", tenantId), orderBy("paymentDate", "desc"));
        unsubscribers.push(onSnapshot(paymentsQuery, (snapshot) => {
            setMyPayments(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        }));
        
        const receiptsCollectionRef = collection(db, `organizations/${orgId}/tenants/${tenantId}/serviceReceipts`);
        const receiptsQuery = query(receiptsCollectionRef, orderBy('createdAt', 'desc'));
        unsubscribers.push(onSnapshot(receiptsQuery, (snapshot) => {
            setServiceReceipts(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        }));

        return () => unsubscribers.forEach(unsub => unsub());

    }, [userProfile]);

    useEffect(() => {
        if (!myRental?.propertyId || !userProfile?.orgId) {
            setMyProperty(null);
            setMyMaintenance([]);
            return;
        }
        
        let unsubscribers = [];
        const propertyRef = doc(db, `organizations/${userProfile.orgId}/properties`, myRental.propertyId);
        unsubscribers.push(onSnapshot(propertyRef, (docSnap) => {
            if (docSnap.exists()) setMyProperty({ id: docSnap.id, ...docSnap.data() });
        }));

        const maintenanceQuery = query(collection(db, `organizations/${userProfile.orgId}/maintenance`), where("propertyId", "==", myRental.propertyId), orderBy("createdAt", "desc"));
        unsubscribers.push(onSnapshot(maintenanceQuery, (snapshot) => {
            setMyMaintenance(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        }));
        
        return () => unsubscribers.forEach(unsub => unsub());

    }, [myRental, userProfile]);

    const handleReportMaintenance = async (e) => {
        e.preventDefault();
        if(!newMaintDesc.trim() || !myProperty?.id || !userProfile.orgId) return;
        setIsSubmitting(true);
        try {
            const data = {
                propertyId: myProperty.id,
                description: newMaintDesc,
                status: 'Pendiente',
                reportedBy: userProfile.uid,
                createdAt: new Date().toISOString(),
            };
            await addDoc(collection(db, `organizations/${userProfile.orgId}/maintenance`), data);
            // No se agrega log de auditoría desde el portal de inquilino para no sobrecargarlo.
            setNewMaintDesc('');
            setIsModalOpen(false);
        } catch (error) {
            console.error("Error al reportar mantenimiento:", error);
        }
        setIsSubmitting(false);
    };

    if (isLoading) {
        return <FullPageLoader message="Cargando tu portal..." />;
    }

    return (
        <div className="p-4 sm:p-8 min-h-screen bg-gray-50">
            <header className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Portal del Inquilino</h1>
                    <p className="text-gray-600">Bienvenido, {myTenantData?.name || 'Inquilino'}.</p>
                </div>
                <Button variant="outline" onClick={onLogout}><LogOut className="mr-2 h-4 w-4"/>Cerrar Sesión</Button>
            </header>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card><CardHeader><CardTitle>Mi Contrato</CardTitle></CardHeader><CardContent>{myProperty?.name ? (<dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm"><div className="font-semibold text-gray-500">Propiedad:</div><div>{myProperty.name}</div><div className="font-semibold text-gray-500">Dirección:</div><div>{myProperty.address}</div><div className="font-semibold text-gray-500">Monto de Alquiler:</div><div>S/ {parseFloat(myRental?.rentAmount || 0).toFixed(2)}</div><div className="font-semibold text-gray-500">Fin de Contrato:</div><div>{formatDate(myRental?.endDate)}</div></dl>) : <EmptyState icon={FileText} title="Sin Contrato" message="No se encontró un contrato de alquiler activo." /> }</CardContent></Card>
                    <Card><CardHeader><CardTitle>Mantenimiento</CardTitle></CardHeader><CardContent><Button onClick={() => setIsModalOpen(true)} className="w-full" disabled={!myProperty?.id}><Plus className="mr-2 h-4 w-4"/>Nuevo Reporte de Incidente</Button>{myMaintenance.length > 0 && <div className="mt-4"><h4 className="font-medium text-sm mb-2">Mis Reportes Anteriores</h4><ul className="space-y-2">{myMaintenance.map(task => (<li key={task.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-md text-sm"><span>{task.description}</span><span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${task.status === 'Completado' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{task.status}</span></li>))}</ul></div>}</CardContent></Card>
                </div>
                <div className="space-y-6">
                    <Card><CardHeader><CardTitle>Historial de Pagos</CardTitle></CardHeader><CardContent>{myPayments.length > 0 ? (<ul className="space-y-2">{myPayments.map(p => (<li key={p.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-md text-sm"><div><p className="font-medium">{p.concept}</p><p className="text-xs text-gray-500">{formatDate(p.paymentDate)}</p></div><div className={`font-bold ${p.status === 'Pagado' || p.status === 'Verificado' ? 'text-green-600' : 'text-yellow-600'}`}>S/ {parseFloat(p.amount || 0).toFixed(2)}</div></li>))}</ul>) : <EmptyState icon={DollarSign} title="Sin Pagos" message="Tu historial de pagos aparecerá aquí." />}</CardContent></Card>
                    <Card><CardHeader><CardTitle>Recibos de Servicios</CardTitle></CardHeader><CardContent>{serviceReceipts.length > 0 ? (<ul className="space-y-2">{serviceReceipts.map(r => (<li key={r.id} className="flex justify-between items-center p-2 bg-gray-50 rounded-md text-sm"><span>{r.name}</span><a href={r.url} target="_blank" rel="noopener noreferrer" className="p-2 text-blue-600 hover:bg-blue-50 rounded-full"><Eye size={16}/></a></li>))}</ul>) : <EmptyState icon={Receipt} title="Sin Recibos" message="Tus recibos de servicios aparecerán aquí." />}</CardContent></Card>
                </div>
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Reportar Incidente">
                <form onSubmit={handleReportMaintenance}><p className="text-sm mb-2">Propiedad: <strong>{myProperty?.name}</strong></p><Textarea placeholder="Describe el problema con el mayor detalle posible..." value={newMaintDesc} onChange={(e) => setNewMaintDesc(e.target.value)} required rows={5}/><div className="flex justify-end gap-2 pt-4"><Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Spinner/> : 'Enviar Reporte'}</Button></div></form>
            </Modal>
            
            <div className="fixed bottom-8 right-8 flex flex-col gap-4">
                 <Button onClick={handleWhatsAppContact} className="rounded-full w-16 h-16 shadow-lg bg-green-500 hover:bg-green-600">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                </Button>
                <Button onClick={() => setIsChatOpen(true)} className="rounded-full w-16 h-16 shadow-lg">
                    <Bot size={32} />
                </Button>
            </div>
            {isChatOpen && (
                <AiChatbot 
                    isOpen={isChatOpen} 
                    onClose={() => setIsChatOpen(false)}
                    userProfile={userProfile}
                    rentalData={myRental ? {...myRental, propertyName: myProperty?.name, propertyAddress: myProperty?.address} : {}}
                    paymentsData={myPayments}
                    geminiApiKey={organizationData?.geminiApiKey}
                />
            )}
        </div>
    );
};

// --- Asistente Virtual para Inquilinos ---
const AiChatbot = ({ isOpen, onClose, rentalData, paymentsData, geminiApiKey }) => {
    const [messages, setMessages] = useState([{ text: "¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy sobre tu alquiler?", from: 'ai' }]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!userInput.trim()) return;
        if (!geminiApiKey) {
            setMessages(prev => [...prev, { text: "Lo siento, el asistente virtual no está configurado por el administrador en este momento.", from: 'ai' }]);
            return;
        }

        const newMessages = [...messages, { text: userInput, from: 'user' }];
        setMessages(newMessages);
        setUserInput('');
        setIsLoading(true);

        const prompt = `Eres un asistente virtual para un inquilino de una propiedad. Tu nombre es GestorBot. Responde de forma amable y concisa. Utiliza la siguiente información para responder la pregunta del inquilino. Si la pregunta no se puede responder con esta información, di amablemente que no tienes esa información y que debe contactar al administrador. Pregunta del inquilino: "${userInput}"`;
        
        const context = {
            contrato: rentalData,
            ultimos_pagos: paymentsData.slice(0, 5)
        };

        const { success, data } = await callAIGenerator(prompt, geminiApiKey, context);
        
        setMessages([...newMessages, { text: data, from: 'ai' }]);
        setIsLoading(false);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="✨ Asistente Virtual" size="md">
            <div className="flex flex-col h-[60vh]">
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.from === 'ai' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`p-3 rounded-2xl max-w-sm ${msg.from === 'ai' ? 'bg-gray-200 text-gray-800' : 'bg-blue-600 text-white'}`}>
                                <div className="prose prose-sm max-w-full" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}></div>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="p-3 rounded-2xl bg-gray-200">
                                <Spinner className="h-4 w-4 border-gray-600" />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
                <div className="p-4 border-t">
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                        <Input 
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder="Escribe tu pregunta aquí..."
                            disabled={isLoading}
                        />
                        <Button type="submit" disabled={isLoading}>
                            <Send size={16} />
                        </Button>
                    </form>
                </div>
            </div>
        </Modal>
    );
};

// --- Gestor CRUD con IA ---
const CrudManager = ({ title, collectionName, fields, data = [], appData, orgId, userProfile, renderItem, renderDetailsPanel, customActions, selectedItem, onSelectItem, organizationData }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentItem, setCurrentItem] = useState(null);
    const [formData, setFormData] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDniLoading, setIsDniLoading] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);
    const [docManager, setDocManager] = useState({ isOpen: false, item: null });
    const [receiptModal, setReceiptModal] = useState({ isOpen: false, tenant: null });
    const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
    const [imageFiles, setImageFiles] = useState([]);
    const [imageViewer, setImageViewer] = useState({ isOpen: false, images: [] });

    const showNotification = useContext(NotificationContext);

    const handleRowClick = (item) => {
       if (onSelectItem) {
            if (selectedItem?.id === item.id) {
                onSelectItem(null); 
            } else {
                onSelectItem(item);
            }
       }
    };

    const handleCreateAccess = async (tenantData, tenantId) => {
        if (!tenantData.email || !tenantData.dni) return;

        const password = tenantData.dni;
        const secondaryApp = initializeApp(firebaseConfig, `secondary-auth-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        try {
            const userCredential = await createUserWithEmailAndPassword(secondaryAuth, tenantData.email, password);
            await updateDoc(doc(db, `organizations/${orgId}/tenants`, tenantId), { 
                hasAccess: true, 
                uid: userCredential.user.uid, 
                password: password 
            });
            await addLogEntry(orgId, userProfile, 'CREATE_TENANT_ACCESS', title, { tenantId: tenantId, tenantEmail: tenantData.email });
            showNotification({ title: "Acceso Creado", message: `Acceso creado para ${tenantData.email}. La contraseña es su DNI.` });
        } catch (error) {
            console.error("Error creando acceso:", error);
            if (error.code === 'auth/email-already-in-use') {
                showNotification({ title: "Error de Acceso", message: `El correo ${tenantData.email} ya está en uso. No se pudo crear un nuevo acceso, pero los datos del inquilino se guardaron.` });
            } else {
                showNotification({ title: "Error", message: `Ocurrió un error al crear el acceso: ${error.message}` });
            }
        } finally {
            await deleteApp(secondaryApp);
        }
    };

    const openModal = (item = null) => {
        setCurrentItem(item);
        let initialFormData = fields.reduce((acc, field) => {
            acc[field.name] = item ? item[field.name] : (field.defaultValue !== undefined ? field.defaultValue : '');
            if (field.type === 'date' && !item) acc[field.name] = new Date().toISOString().split('T')[0];
            return acc;
        }, {});

        setFormData(initialFormData);
        setImageFiles([]);
        setIsModalOpen(true);
    };

    const closeModal = () => { setIsModalOpen(false); setCurrentItem(null); setFormData({}); setImageFiles([]); };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleFileChange = (e) => {
        setImageFiles([...e.target.files]);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        const collectionPath = `organizations/${orgId}/${collectionName}`;
        const actionType = currentItem ? 'UPDATE' : 'CREATE';
        const logActionName = `${actionType}_${collectionName.slice(0, -1).toUpperCase()}`;

        try {
            let photoURLs = currentItem?.photoURLs || [];
            if (imageFiles.length > 0) {
                const uploadPromises = imageFiles.map(file => {
                    const filePath = `expense_receipts/${currentItem?.id || Date.now()}/${file.name}`;
                    const fileStorageRef = storageRef(storage, filePath);
                    return uploadBytesResumable(fileStorageRef, file).then(snapshot => getDownloadURL(snapshot.ref));
                });
                const urls = await Promise.all(uploadPromises);
                photoURLs = [...photoURLs, ...urls];
            }

            if (actionType === 'UPDATE') {
                const dataToUpdate = {
                    ...formData,
                    photoURLs,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userProfile.email,
                };
                await updateDoc(doc(db, collectionPath, currentItem.id), dataToUpdate);
                await addLogEntry(orgId, userProfile, logActionName, title, { 
                    docId: currentItem.id, 
                    before: currentItem,
                    after: dataToUpdate 
                });
            } else { // CREATE
                let newDocData = { 
                    ...formData, 
                    photoURLs,
                    orgId, 
                    createdAt: new Date().toISOString(),
                    createdBy: userProfile.email,
                };
                
                if (collectionName === 'expenses') {
                    newDocData.status = 'Pendiente';
                }

                const newDocRef = await addDoc(collection(db, collectionPath), newDocData);
                await addLogEntry(orgId, userProfile, logActionName, title, { docId: newDocRef.id, data: newDocData });
            }
            closeModal();
        } catch (error) {
            console.error("Error guardando el documento:", error);
            showNotification({title: "Error", message: "No se pudo guardar el documento."})
        } finally {
            setIsSubmitting(false);
        }
    };
    
    async function handleDniVerify() {
        if (!formData.dni) return;
        setIsDniLoading(true);
        const result = await consultarDNI(formData.dni);
        if (result.success) {
            setFormData(prev => ({
                ...prev,
                name: result.data.nombreCompleto,
                domicilio: result.data.direccion || prev.domicilio || ''
            }));
        } else {
            showNotification({ title: "Error de DNI", message: `Error al consultar DNI: ${result.message}` });
        }
        setIsDniLoading(false);
    }

    const handleDeleteRequest = (id) => { setItemToDelete(id); setIsConfirmOpen(true); };
    const confirmDelete = async () => {
        if (itemToDelete) {
            try {
                const itemRef = doc(db, `organizations/${orgId}/${collectionName}`, itemToDelete)
                const itemSnap = await getDoc(itemRef);
                const itemData = itemSnap.data();

                await deleteDoc(itemRef);
                await addLogEntry(orgId, userProfile, `DELETE_${collectionName.slice(0, -1).toUpperCase()}`, title, { docId: itemToDelete, deletedData: itemData });
            } catch (error) { console.error("Error eliminando:", error); }
        }
        setIsConfirmOpen(false);
        setItemToDelete(null);
    };

    const handleMaintenanceAnalysis = async () => {
        if (!formData.description) {
            showNotification({ title: "Información Requerida", message: "Por favor, ingresa una descripción del problema primero." });
            return;
        }
        setIsAiAnalyzing(true);

        const prompt = `Actúa como un experto en mantenimiento de propiedades. Basado en la siguiente descripción de un problema, proporciona un análisis en formato JSON. Descripción: "${formData.description}". El costo estimado debe estar en Soles Peruanos (PEN).`;
        const schema = {
            type: "OBJECT",
            properties: {
                priority: { type: "STRING", enum: ["Baja", "Media", "Alta", "Urgente"] },
                estimatedCost: { type: "STRING" },
                suggestedMaterials: { type: "ARRAY", items: { "type": "STRING" } }
            },
            required: ["priority", "estimatedCost", "suggestedMaterials"]
        };

        const { success, data } = await callAIGenerator(prompt, organizationData?.geminiApiKey, {}, schema);
        
        if (success) {
            setFormData(prev => ({
                ...prev,
                priority: data.priority || prev.priority,
                estimatedCost: data.estimatedCost || prev.estimatedCost,
                suggestedMaterials: (data.suggestedMaterials || []).join('\n'),
            }));
        } else {
            showNotification({ title: "Error de IA", message: `Error del Asistente de IA: ${data}` });
        }
        setIsAiAnalyzing(false);
    };
    
    const modalFooter = currentItem && (
        <div className="text-xs text-gray-500">
            {currentItem.updatedAt && (
                <p>Última edición: {formatDate(currentItem.updatedAt, true)} por <strong>{currentItem.updatedBy || 'N/A'}</strong></p>
            )}
            {currentItem.createdAt && !currentItem.updatedAt && (
                <p>Creado: {formatDate(currentItem.createdAt, true)} por <strong>{currentItem.createdBy || 'N/A'}</strong></p>
            )}
        </div>
    );

    return (
        <div className="flex gap-6">
            <div className="flex-grow">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-800">{title}</h1>
                    <Button onClick={() => openModal()}><Plus className="mr-2" size={16}/> Añadir {title.slice(0,-1)}</Button>
                </div>
                <Card>
                    <CardContent>
                        {(data || []).length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    {renderItem({ openModal, handleDelete: handleDeleteRequest, data, appData, openDocManager: (item) => setDocManager({isOpen: true, item}), openReceiptManager: (tenant) => setReceiptModal({ isOpen: true, tenant }), handleRowClick, customActions, openImageViewer: (images) => setImageViewer({isOpen: true, images}) })}
                                </table>
                            </div>
                        ) : (
                            <EmptyState icon={Search} title={`No hay ${title.toLowerCase()}`} message="Añade un nuevo elemento para empezar." />
                        )}
                    </CardContent>
                </Card>
            </div>
            
            {selectedItem && renderDetailsPanel && (
                <div className="w-full max-w-md flex-shrink-0">
                    {renderDetailsPanel({ item: selectedItem, appData, orgId, onClose: () => onSelectItem(null) })}
                </div>
            )}

            {docManager.isOpen && (
                <DocumentManager 
                    isOpen={docManager.isOpen}
                    onClose={() => setDocManager({ isOpen: false, item: null })}
                    item={docManager.item}
                    collectionName={collectionName}
                    orgId={orgId}
                    userProfile={userProfile}
                />
            )}

            {imageViewer.isOpen && (
                <ImageViewerModal 
                    isOpen={imageViewer.isOpen}
                    onClose={() => setImageViewer({isOpen: false, images: []})}
                    images={imageViewer.images}
                />
            )}

            {receiptModal.isOpen && (
                <ServiceReceiptManager
                    isOpen={receiptModal.isOpen}
                    onClose={() => setReceiptModal({ isOpen: false, tenant: null })}
                    tenant={receiptModal.tenant}
                    orgId={orgId}
                    userProfile={userProfile}
                />
            )}

            <Modal isOpen={isModalOpen} onClose={closeModal} title={`${currentItem ? 'Editar' : 'Añadir'} ${title.slice(0,-1)}`} footerContent={modalFooter}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {fields.map(field => (
                        <div key={field.name}>
                            <label className="text-sm font-medium">{field.label}</label>
                            <div className="flex items-center gap-2">
                                {field.type === 'select' ? (<Select name={field.name} value={formData[field.name] || ''} onChange={handleInputChange} required>{<option value="" disabled>Seleccionar...</option>}{(field.options(appData, field.optionsContext) || []).map(opt => <option key={opt.id} value={opt.id}>{opt.name}</option>)}</Select>) :
                                    field.type === 'textarea' ? (<Textarea name={field.name} value={formData[field.name] || ''} onChange={handleInputChange} required placeholder={field.placeholder} rows={field.rows || 3} />) :  
                                    <Input type={field.type} name={field.name} value={formData[field.name] || ''} onChange={handleInputChange} required placeholder={field.placeholder} />
                                }
                                {field.name === 'dni' && (<Button type="button" onClick={handleDniVerify} disabled={isDniLoading} className="p-2 gap-1">{isDniLoading ? <Spinner/> : 'Verificar'}</Button>)}
                                {collectionName === 'maintenance' && field.name === 'description' && (
                                    <Button type="button" onClick={handleMaintenanceAnalysis} disabled={isAiAnalyzing || !organizationData?.geminiApiKey} className="p-2 gap-1" title={!organizationData?.geminiApiKey ? "API Key no configurada" : "Analizar con IA"}>
                                        {isAiAnalyzing ? <Spinner/> : <Sparkles size={16}/>}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                    {collectionName === 'expenses' && (
                        <div>
                            <label className="text-sm font-medium">Fotos de Evidencia</label>
                            <Input type="file" onChange={handleFileChange} multiple accept="image/*" />
                        </div>
                    )}
                    <div className="flex justify-end gap-2 pt-4"><Button type="button" variant="outline" onClick={closeModal}>Cancelar</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Spinner /> : 'Guardar'}</Button></div>
                </form>
            </Modal>
            
            <Modal isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)} title="Confirmar Eliminación" size="sm">
                <div className="text-center"><AlertTriangle className="mx-auto h-12 w-12 text-red-500" /><h3 className="mt-2 text-lg font-medium">¿Estás seguro?</h3><p className="mt-1 text-sm text-gray-500">Esta acción no se puede deshacer y quedará registrada.</p></div>
                <div className="flex justify-center gap-4 mt-6"><Button variant="outline" onClick={() => setIsConfirmOpen(false)}>Cancelar</Button><Button variant="destructive" onClick={confirmDelete}>Sí, eliminar</Button></div>
            </Modal>
        </div>
    );
};

// --- Panel de Detalles ---
const DetailsPanel = ({ item, appData, onClose, itemType, handlePaymentStatusChange, userProfile }) => {
    const { properties, tenants, rentals, payments, maintenance } = appData;

    const renderPropertyDetails = () => {
        const activeRentals = rentals.filter(r => r.propertyId === item.id && r.status === 'Activo');
        const propertyMaintenance = maintenance.filter(m => m.propertyId === item.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return (
            <>
                <CardTitle>{item.name}</CardTitle>
                <p className="text-sm text-gray-500">{item.address}</p>
                <div className="mt-4 space-y-4 text-sm">
                    <h4 className="font-semibold">Inquilinos Activos</h4>
                    {activeRentals.length > 0 ? (
                        <ul className="space-y-2">
                           {activeRentals.map(rental => {
                               const tenant = findById(tenants, rental.tenantId);
                               return (
                                   <li key={rental.id} className="p-2 bg-gray-50 rounded-md">
                                       <p className="font-medium">{tenant.name || 'N/A'}</p>
                                       <p className="text-xs text-gray-500">Contrato vence: {formatDate(rental.endDate)}</p>
                                   </li>
                               )
                           })}
                        </ul>
                    ) : <p>Actualmente disponible.</p>}
                    
                    <h4 className="font-semibold pt-3 border-t mt-3">Mantenimiento Reciente</h4>
                    {propertyMaintenance.length > 0 ? (
                        <ul className="list-disc pl-5 space-y-1">
                            {propertyMaintenance.slice(0,3).map(m => <li key={m.id}>{m.description} ({m.status})</li>)}
                        </ul>
                    ) : <p>Sin reportes de mantenimiento.</p>}
                </div>
            </>
        );
    };

    const renderTenantDetails = () => {
        const rental = rentals.find(r => r.tenantId === item.id && r.status === 'Activo');
        const property = rental ? findById(properties, rental.propertyId) : null;
        const tenantPayments = payments.filter(p => p.tenantId === item.id).sort((a,b) => new Date(b.paymentDate) - new Date(a.paymentDate));
        
        return (
            <>
                <CardTitle>{item.name}</CardTitle>
                <p className="text-sm text-gray-500">{item.email} | {item.phone}</p>
                <div className="mt-4 space-y-4 text-sm">
                    {rental && property && (
                          <div>
                            <h4 className="font-semibold">Contrato Activo</h4>
                            <p><strong>Propiedad:</strong> {property.name}</p>
                            <p><strong>Monto:</strong> S/ {parseFloat(rental.rentAmount).toFixed(2)}</p>
                            <p><strong>Fin de contrato:</strong> {formatDate(rental.endDate)}</p>
                        </div>
                    )}

                    <div>
                        <h4 className="font-semibold">Credenciales de Acceso</h4>
                        {item.hasAccess ? (
                            <>
                                <p><strong>Email:</strong> {item.email}</p>
                                <p><strong>Contraseña:</strong> <span className="font-mono p-1 bg-gray-100 rounded-md select-all">{item.password || item.dni || 'No registrada'}</span></p>
                            </>
                        ) : (
                            <p>El inquilino aún no tiene acceso al portal.</p>
                        )}
                    </div>
                    
                    <div>
                         <h4 className="font-semibold">Historial de Pagos Completo</h4>
                         {tenantPayments.length > 0 ? (
                                  <div className="max-h-64 overflow-y-auto border rounded-md mt-2">
                                       <ul className="divide-y divide-gray-100">
                                           {tenantPayments.map(p => (
                                               <li key={p.id} className="p-2 flex justify-between items-center">
                                                   <div>
                                                       <p className="font-medium">{p.concept}</p>
                                                       <p className="text-xs text-gray-500">{formatDate(p.paymentDate)}</p>
                                                   </div>
                                                   <PaymentStatusButtons payment={p} handlePaymentStatusChange={handlePaymentStatusChange} userProfile={userProfile} />
                                               </li>
                                           ))}
                                       </ul>
                                  </div>
                        ) : <p>No se encontraron pagos.</p>}
                    </div>
               </div>
            </>
        )
    };
    
    return (
        <Card className="sticky top-8">
             <CardHeader className="justify-between">
                <span>Vista Rápida</span>
                <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full w-8 h-8 -mr-2">
                    <X size={16} />
                </Button>
            </CardHeader>
            <CardContent>
                {itemType === 'Property' && renderPropertyDetails()}
                {itemType === 'Tenant' && renderTenantDetails()}
            </CardContent>
        </Card>
    );
};

// --- Página del Co-Piloto de IA ---
const AiCoPilotPage = ({ userProfile, organizationData }) => {
    const [task, setTask] = useState('draftEmail');
    const [context, setContext] = useState('');
    const [result, setResult] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!context.trim()) return;
        setIsLoading(true);
        let prompt = '';
        if (task === 'draftEmail') {
            prompt = `Redacta un correo electrónico profesional para la siguiente situación: ${context}`;
        } else if (task === 'analyzeData') {
            prompt = `Analiza los siguientes datos y proporciona un resumen y 3 puntos clave: ${context}`;
        }
        const { success, data } = await callAIGenerator(prompt, organizationData?.geminiApiKey);
        setResult(data);
        setIsLoading(false);
    };

    if (!organizationData?.geminiApiKey) {
        return <EmptyState icon={KeyRound} title="Configuración de API Requerida" message="Para usar el Co-piloto de IA, primero debes añadir tu clave de API de Gemini en la página de Ajustes." />;
    }

    return (
        <div className="flex flex-col h-full">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">✨ Co-piloto de IA</h1>
            <p className="text-gray-600 mb-6">Tu asistente para tareas de comunicación y análisis.</p>
            <Card>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="text-sm font-medium">Tarea a Realizar</label>
                            <Select value={task} onChange={e => setTask(e.target.value)}>
                                <option value="draftEmail">Redactar Correo</option>
                                <option value="analyzeData">Analizar Datos</option>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm font-medium">Contexto</label>
                            <Textarea value={context} onChange={e => setContext(e.target.value)} rows={5} placeholder={task === 'draftEmail' ? "Ej: Recordatorio de pago de alquiler para el inquilino del apto 101, que vence el 30 de este mes." : "Ej: Pega aquí los datos que quieres analizar..."}/>
                        </div>
                        <Button type="submit" disabled={isLoading || !context.trim()}>{isLoading ? <Spinner /> : 'Generar Respuesta'}</Button>
                    </form>
                </CardContent>
            </Card>

            {result &&  
                <Card className="mt-6">
                    <CardHeader><CardTitle>Resultado Generado</CardTitle></CardHeader>
                    <CardContent>
                        <div className="prose prose-sm max-w-full" dangerouslySetInnerHTML={{ __html: renderMarkdown(result)}}></div>
                    </CardContent>
                </Card>
            }
        </div>
    );
};

// --- Página de Equipo ---
const TeamPage = ({ orgId, userProfile }) => {
    const [teamMembers, setTeamMembers] = useState([]);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [newInvite, setNewInvite] = useState({ email: '', role: 'Gestor', dni: '' });
    const [editingUser, setEditingUser] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const showNotification = useContext(NotificationContext);

    useEffect(() => {
        if (!orgId) return;
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where("orgId", "==", orgId));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTeamMembers(members);
        });
        return () => unsubscribe();
    }, [orgId]);

    const handleInviteUser = async (e) => {
        e.preventDefault();
        if (!newInvite.email || !newInvite.role || !newInvite.dni) {
            showNotification({ title: "Error", message: "Por favor, completa todos los campos." });
            return;
        }
        setIsSubmitting(true);
        
        const secondaryApp = initializeApp(firebaseConfig, `secondary-auth-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);

        try {
            const userCredential = await createUserWithEmailAndPassword(secondaryAuth, newInvite.email, newInvite.dni);
            const newUser = userCredential.user;

            await setDoc(doc(db, "users", newUser.uid), {
                email: newUser.email,
                role: newInvite.role,
                dni: newInvite.dni,
                orgId: orgId,
                uid: newUser.uid
            });

            await addLogEntry(orgId, userProfile, 'CREATE_TEAM_MEMBER', 'Equipo', { newUserEmail: newUser.email, role: newInvite.role });
            
            showNotification({ title: "Usuario Creado", message: `¡Usuario ${newUser.email} creado!\nSu contraseña inicial es su DNI: ${newInvite.dni}` });
            
            setIsInviteModalOpen(false);
            setNewInvite({ email: '', role: 'Gestor', dni: '' });

        } catch (error) {
            console.error("Error creating team member:", error);
            showNotification({ title: "Error", message: `Error al crear el miembro del equipo: ${error.message}` });
        } finally {
            await deleteApp(secondaryApp);
            setIsSubmitting(false);
        }
    };

    const openEditModal = (user) => {
        setEditingUser(user);
        setIsEditModalOpen(true);
    };

    const handleUpdateRole = async (e) => {
        e.preventDefault();
        if (!editingUser) return;
        setIsSubmitting(true);
        const userDocRef = doc(db, 'users', editingUser.id);
        try {
            await updateDoc(userDocRef, { role: editingUser.role });
            await addLogEntry(orgId, userProfile, 'UPDATE_TEAM_MEMBER_ROLE', 'Equipo', { targetUser: editingUser.email, newRole: editingUser.role });
            setIsEditModalOpen(false);
            setEditingUser(null);
        } catch (error) {
            console.error("Error updating role:", error);
            showNotification({ title: "Error", message: "Error al actualizar el rol." });
        }
        setIsSubmitting(false);
    };

    const handleDeleteUser = async (userToDelete) => {
        const confirmed = await showNotification({
            title: "Confirmar Eliminación",
            message: `¿Seguro que quieres eliminar a ${userToDelete.email} del equipo? Esta acción eliminará su perfil de la organización pero no su cuenta de autenticación.`,
            confirmText: "Sí, eliminar",
            isDestructive: true
        });
        if (!confirmed) return;
        
        try {
            await deleteDoc(doc(db, "users", userToDelete.id));
            await addLogEntry(orgId, userProfile, 'DELETE_TEAM_MEMBER', 'Equipo', { deletedUserEmail: userToDelete.email });
            showNotification({ title: "Éxito", message: 'Usuario eliminado del equipo.' });
        } catch (error) {
            console.error("Error deleting user:", error);
            showNotification({ title: "Error", message: 'No se pudo eliminar al usuario.' });
        }
    };

    if (userProfile.role !== 'Admin') {
        return <EmptyState icon={ShieldCheck} title="Acceso Denegado" message="Solo los administradores pueden gestionar el equipo." />;
    }
    
    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Gestionar Equipo</h1>
                <Button onClick={() => setIsInviteModalOpen(true)} className="gap-2"><Plus size={16}/>Invitar Miembro</Button>
            </div>
            <Card>
                <CardContent>
                    {teamMembers.length > 0 ? (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase">Correo</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium uppercase">Rol</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium uppercase">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {teamMembers.map(member => (
                                    <tr key={member.id}>
                                        <td className="p-4">{member.email}</td>
                                        <td className="p-4">{member.role}</td>
                                        <td className="p-4 text-right">
                                            {member.uid !== userProfile.uid && (
                                                <div className="flex gap-2 justify-end">
                                                    <Button onClick={() => openEditModal(member)} variant="ghost" className="p-2"><Edit size={16}/></Button>
                                                    <Button onClick={() => handleDeleteUser(member)} variant="ghost" className="text-red-500 p-2"><Trash2 size={16}/></Button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <EmptyState icon={Users2} title="No hay miembros en el equipo" message="Invita a miembros a tu equipo para colaborar."/>}
                </CardContent>
            </Card>

            <Modal isOpen={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)} title="Invitar Nuevo Miembro">
                <form onSubmit={handleInviteUser} className="space-y-4">
                    <div>
                        <label>Correo Electrónico</label>
                        <Input type="email" value={newInvite.email} onChange={e => setNewInvite({...newInvite, email: e.target.value})} required/>
                    </div>
                    <div>
                        <label>DNI (Será la contraseña inicial)</label>
                        <Input type="text" value={newInvite.dni} onChange={e => setNewInvite({...newInvite, dni: e.target.value})} required maxLength="8" />
                    </div>
                    <div>
                        <label>Asignar Rol</label>
                        <Select value={newInvite.role} onChange={e => setNewInvite({...newInvite, role: e.target.value})}>
                            <option value="Gestor">Gestor</option>
                            <option value="Verificador">Verificador</option>
                            <option value="Contador">Contador</option>
                        </Select>
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => setIsInviteModalOpen(false)}>Cancelar</Button>
                        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Spinner/> : "Crear Miembro"}</Button>
                    </div>
                </form>
            </Modal>

            {editingUser && (
                <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title={`Editar Rol de ${editingUser.email}`}>
                    <form onSubmit={handleUpdateRole} className="space-y-4">
                        <div>
                            <label>Rol</label>
                            <Select value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value})}>
                                <option value="Gestor">Gestor</option>
                                <option value="Verificador">Verificador</option>
                                <option value="Contador">Contador</option>
                            </Select>
                        </div>
                        <div className="flex justify-end gap-2 pt-4">
                            <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
                            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Spinner/> : "Guardar Cambios"}</Button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
};

// --- Página de Registro de Actividad ---
const ActivityLogPage = ({ appData }) => {
    const { logs = [] } = appData;

    const renderLogDetails = (log) => {
        const { details, action } = log;
        if (!details) return <p>N/A</p>;

        if (action && action.startsWith('UPDATE_')) {
            const { before, after } = details;
            if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
                return <pre className="whitespace-pre-wrap max-w-md overflow-x-auto bg-gray-100 p-2 rounded-md text-xs"><code>{JSON.stringify(details, null, 2)}</code></pre>;
            }

            const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
            const changedKeys = allKeys.filter(key => before[key] !== after[key]);
            
            if (changedKeys.length === 0) {
                return <p className="text-xs text-gray-500">Sin cambios visibles.</p>
            }

            return (
                <div className="space-y-1">
                    {changedKeys.map(key => (
                       <div key={key} className="flex items-start text-xs">
                           <span className="font-semibold mr-1 w-24 truncate">{key}:</span> 
                           <div className="flex flex-col">
                               <span className="text-red-600 line-through">{String(before[key])}</span>
                               <div className="flex items-center">
                                   <ArrowRight size={12} className="text-gray-400 mr-1"/>
                                   <span className="text-green-600">{String(after[key])}</span>
                               </div>
                           </div>
                       </div>
                    ))}
                </div>
            )
        }
        
        return <pre className="whitespace-pre-wrap max-w-md overflow-x-auto bg-gray-100 p-2 rounded-md text-xs"><code>{JSON.stringify(details, null, 2)}</code></pre>;
    }

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Registro de Actividad</h1>
            <Card>
                <CardContent>
                     {logs.length > 0 ? (
                         <div className="overflow-x-auto">
                             <table className="min-w-full divide-y divide-gray-200">
                                 <thead className="bg-gray-50">
                                     <tr>
                                         <th className="p-4 text-left text-xs font-medium text-gray-500 uppercase">Fecha y Hora</th>
                                         <th className="p-4 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                                         <th className="p-4 text-left text-xs font-medium text-gray-500 uppercase">Sección</th>
                                         <th className="p-4 text-left text-xs font-medium text-gray-500 uppercase">Acción</th>
                                         <th className="p-4 text-left text-xs font-medium text-gray-500 uppercase">Detalles</th>
                                     </tr>
                                 </thead>
                                 <tbody className="bg-white divide-y divide-gray-200">
                                     {logs.map(log => (
                                         <tr key={log.id}>
                                             <td className="p-4 whitespace-nowrap text-sm">{formatDate(log.timestamp, true)}</td>
                                             <td className="p-4 whitespace-nowrap text-sm">{log.userEmail}</td>
                                             <td className="p-4 whitespace-nowrap text-sm">{log.section || 'General'}</td>
                                             <td className="p-4 whitespace-nowrap text-sm font-mono bg-gray-50 rounded-md">{log.action}</td>
                                             <td className="p-4 text-xs">{renderLogDetails(log)}</td>
                                         </tr>
                                     ))}
                                 </tbody>
                             </table>
                         </div>
                    ) : <EmptyState icon={Clock} title="Sin actividad" message="Aún no se han registrado cambios en el sistema." />}
                </CardContent>
            </Card>
        </div>
    );
};

// --- Renderizador de tablas y definiciones de campos ---
const renderTable = ({ openModal, handleDelete, data, appData, fields, itemType, openDocManager, openReceiptManager, handleRowClick, customActions, openImageViewer, handleStatusChange, userProfile }) => (
    <>
        <thead className="bg-gray-50">
            <tr>
                {fields.map(f => <th key={f.name} className="p-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{f.label}</th>)}
                <th className="p-4"></th>
            </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
            {data.map(item => (
                <tr key={item.id} onClick={() => handleRowClick && handleRowClick(item)} className={`${handleRowClick ? 'hover:bg-gray-50 cursor-pointer' : ''}`}>
                    {fields.map(field => (
                        <td key={field.name} className="p-4 whitespace-nowrap text-sm">
                            {field.name === 'status' && itemType === 'Payment' ? <PaymentStatusButtons payment={item} handlePaymentStatusChange={handleStatusChange} userProfile={userProfile} /> :
                             field.name === 'status' && itemType === 'Expense' ? <ExpenseStatusButtons expense={item} handleExpenseStatusChange={handleStatusChange} userProfile={userProfile} /> :
                             field.render ? field.render(item, appData) : item[field.name]
                            }
                        </td>
                    ))}
                    <td className="p-2 text-right whitespace-nowrap">
                        <div className="flex justify-end items-center">
                            {customActions && customActions(item)}
                            {itemType === 'Tenant' && <Button onClick={(e) => { e.stopPropagation(); openReceiptManager(item); }} variant="ghost" className="p-2 text-blue-600" title="Gestionar Recibos de Servicios"><Receipt size={16}/></Button>}
                            {itemType === 'Expense' && item.photoURLs?.length > 0 && <Button onClick={(e) => { e.stopPropagation(); openImageViewer(item.photoURLs); }} variant="ghost" className="p-2 text-indigo-600" title="Ver Fotos"><Camera size={16}/></Button>}
                            <Button onClick={(e) => { e.stopPropagation(); openDocManager(item); }} variant="ghost" className="p-2 text-gray-500" title="Gestionar Documentos"><FileSignature size={16}/></Button>
                            <Button onClick={(e) => { e.stopPropagation(); openModal(item);}} variant="ghost" className="p-2" title="Editar"><Edit size={16}/></Button>
                            <Button onClick={(e) => { e.stopPropagation(); handleDelete(item.id);}} variant="ghost" className="text-red-500 p-2" title="Eliminar"><Trash2 size={16}/></Button>
                        </div>
                    </td>
                </tr>
            ))}
        </tbody>
    </>
);

const PaymentStatusButtons = ({ payment, handlePaymentStatusChange, userProfile }) => {
    const { status } = payment;

    const handleNextStatus = (e) => {
        e.stopPropagation(); 
        let nextStatus;
        if (status === 'Pendiente') nextStatus = 'Pagado';
        else if (status === 'Pagado') nextStatus = 'Verificado';
        
        if (nextStatus) {
            handlePaymentStatusChange(payment, nextStatus);
        }
    };
    
    if (status === 'Pendiente') {
        return <Button onClick={handleNextStatus} variant="outline" className="text-yellow-600 border-yellow-300 hover:bg-yellow-50 text-xs px-2 py-1">Marcar Pagado y Notificar</Button>;
    }
    
    const canVerify = userProfile.role === 'Admin' || userProfile.role === 'Verificador';
    if (status === 'Pagado' && canVerify) {
        return <Button onClick={handleNextStatus} variant="outline" className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs px-2 py-1">Verificar Pago</Button>;
    }
    
    const statusInfo = {
        Pendiente: 'bg-yellow-100 text-yellow-800',
        Pagado: 'bg-blue-100 text-blue-800',
        Verificado: 'bg-green-100 text-green-800',
    };

    return <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusInfo[status]}`}>{status}</span>;
};

const ExpenseStatusButtons = ({ expense, handleExpenseStatusChange, userProfile }) => {
    const { status } = expense;
    const canVerify = userProfile.role === 'Admin' || userProfile.role === 'Verificador';

    const handleVerify = (e) => {
        e.stopPropagation();
        handleExpenseStatusChange(expense, 'Verificado');
    };

    if (status === 'Pendiente' && canVerify) {
        return <Button onClick={handleVerify} variant="outline" className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 text-xs px-2 py-1">Verificar Gasto</Button>;
    }

    const statusInfo = {
        Pendiente: 'bg-yellow-100 text-yellow-800',
        Verificado: 'bg-green-100 text-green-800',
    };

    return <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusInfo[status]}`}>{status}</span>;
};


// --- Definiciones de Campos ---
const propertyFields = [
    { name: 'name', label: 'Nombre/ID', type: 'text'},
    { name: 'type', label: 'Tipo', type: 'select', options: () => [{id: 'Residencial', name: 'Residencial'}, {id: 'Comercial', name: 'Comercial'}, {id: 'Terreno Agricola', name: 'Terreno Agricola'}] },
    { name: 'address', label: 'Dirección', type: 'text' },
    { name: 'detailedDescription', label: 'Descripción Registral', type: 'textarea', rows: 4, placeholder: 'Ej: INMUEBLE UBICADO EN...' },
    { name: 'status', label: 'Estado', type: 'select', options: () => [{id: 'Disponible', name: 'Disponible'}, {id: 'Alquilado', name: 'Alquilado'}, {id: 'Mantenimiento', name: 'Mantenimiento'}], render: (item) => <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.status === 'Disponible' ? 'bg-green-100 text-green-800' : item.status === 'Alquilado' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{item.status}</span>}
];
const rentalFields = [
    { name: 'propertyId', label: 'Propiedad', type: 'select', options: (data) => data.properties || [], render: (item, data) => findById(data.properties, item.propertyId).name},
    { name: 'tenantId', label: 'Inquilino', type: 'select', options: (data) => data.tenants || [], render: (item, data) => findById(data.tenants, item.tenantId).name},
    { name: 'departmentDetails', label: 'Detalles de Unidad', type: 'textarea', rows: 2, placeholder: 'Ej: Sexto Piso A' },
    { name: 'startDate', label: 'Inicio Contrato', type: 'date', render: (item) => formatDate(item.startDate) },
    { name: 'endDate', label: 'Fin Contrato', type: 'date', render: (item) => formatDate(item.endDate) },
    { name: 'rentAmount', label: 'Alquiler', type: 'number', render: (item) => `S/ ${parseFloat(item.rentAmount || 0).toFixed(2)}`},
    { name: 'status', label: 'Estado', type: 'select', defaultValue: 'Activo', options: () => [{id: 'Activo', name: 'Activo'}, {id: 'Finalizado', name: 'Finalizado'}], render: (item) => <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.status === 'Activo' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{item.status}</span>}
];
const tenantFields = [
    { name: 'name', label: 'Nombre Completo', type: 'text' },
    { name: 'dni', label: 'DNI', type: 'text' },
    { name: 'domicilio', label: 'Domicilio', type: 'text' },
    { name: 'email', label: 'Correo', type: 'email' },
    { name: 'phone', label: 'Teléfono', type: 'tel' }
];

const templateFields = [
    { name: 'name', label: 'Nombre de la Plantilla', type: 'text', placeholder: 'Ej: Contrato de Alquiler Residencial 2024' },
    { name: 'description', label: 'Descripción', type: 'text', placeholder: 'Ej: Plantilla estándar para apartamentos.' },
    { name: 'content', label: 'Contenido de la Plantilla', type: 'textarea', rows: 15, placeholder: 'Pega aquí el texto completo de tu contrato. Usa placeholders como [NOMBRE_INQUILINO], [DNI_INQUILINO], etc.' }
];

const paymentFields = [
    { name: 'rentalId', label: 'Contrato', type: 'select', options: (data) => (data.rentals || []).filter(r => r.status === 'Activo').map(r => ({id: r.id, name: `${findById(data.tenants, r.tenantId).name} - ${findById(data.properties, r.propertyId).name}`})), render: (item, data) => { const rental = findById(data.rentals, item.rentalId); return rental ? `${findById(data.tenants, rental.tenantId).name}`: 'N/A'}},
    { name: 'amount', label: 'Monto (S/)', type: 'number', render: (item) => `S/ ${parseFloat(item.amount || 0).toFixed(2)}` },
    { name: 'paymentDate', label: 'Fecha', type: 'date', render: (item) => formatDate(item.paymentDate)},
    { name: 'concept', label: 'Concepto', type: 'text' },
    { name: 'status', label: 'Estado', type: 'select', defaultValue: 'Pendiente', options: () => [{id: 'Pendiente', name: 'Pendiente'}, {id: 'Pagado', name: 'Pagado'}, {id: 'Verificado', name: 'Verificado'}]}
];
const expenseFields = [ 
    { name: 'propertyId', label: 'Propiedad', type: 'select', options: (data) => data.properties || [], render: (item, data) => findById(data.properties, item.propertyId).name }, 
    { name: 'amount', label: 'Monto (S/)', type: 'number', render: (item) => `S/ ${parseFloat(item.amount || 0).toFixed(2)}` }, 
    { name: 'date', label: 'Fecha', type: 'date', render: (item) => formatDate(item.date) }, 
    { name: 'description', label: 'Descripción', type: 'text' }, 
    { name: 'category', label: 'Categoría', type: 'select', options: () => [{id: 'Reparación', name: 'Reparación'}, {id: 'Servicios', name: 'Servicios'}, {id: 'Impuestos', name: 'Impuestos'}] },
    { name: 'status', label: 'Estado', type: 'select', defaultValue: 'Pendiente', options: () => [{id: 'Pendiente', name: 'Pendiente'}, {id: 'Verificado', name: 'Verificado'}]}
];

const maintenanceFields = [ 
    { name: 'propertyId', label: 'Propiedad', type: 'select', options: (data) => data.properties || [], render: (item, data) => findById(data.properties, item.propertyId).name }, 
    { name: 'description', label: 'Descripción', type: 'textarea' }, 
    { name: 'priority', label: 'Prioridad', type: 'select', options: () => [{id: 'Baja', name: 'Baja'}, {id: 'Media', name: 'Media'}, {id: 'Alta', name: 'Alta'}, {id: 'Urgente', name: 'Urgente'}], defaultValue: 'Media' },
    { name: 'estimatedCost', label: 'Costo Estimado (S/)', type: 'text', placeholder: 'Ej: 150.00' },
    { name: 'suggestedMaterials', label: 'Materiales Sugeridos (IA)', type: 'textarea' },
    { name: 'status', label: 'Estado', type: 'select', options: () => [{id: 'Pendiente', name: 'Pendiente'}, {id: 'En Progreso', name: 'En Progreso'}, {id: 'Completado', name: 'Completado'}], defaultValue: 'Pendiente', render: (item) => <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.status === 'Completado' ? 'bg-green-100 text-green-800' : item.status === 'En Progreso' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{item.status}</span>} 
];

// --- Páginas ---
const PropertiesPage = (props) => {
    const [selectedItem, setSelectedItem] = useState(null);
    return (
        <CrudManager 
            title="Propiedades" 
            collectionName="properties" 
            fields={propertyFields} 
            {...props} 
            data={props.appData.properties} 
            selectedItem={selectedItem}
            onSelectItem={setSelectedItem}
            renderItem={(renderProps) => renderTable({ ...renderProps, fields: propertyFields.filter(f => f.type !== 'textarea'), itemType: 'Property' })} 
            renderDetailsPanel={(panelProps) => <DetailsPanel {...panelProps} itemType="Property" />} 
        />
    );
};
const TenantsPage = (props) => {
    const [selectedItem, setSelectedItem] = useState(null);
    const [messageModal, setMessageModal] = useState({ isOpen: false, tenant: null });
    const showNotification = useContext(NotificationContext);
    const sendWhatsAppCallable = httpsCallable(functions, 'sendWhatsApp');

    const openMessageModal = (tenant) => {
        setMessageModal({ isOpen: true, tenant });
    };

    const handleSendMessage = async (tenant, message) => {
        if (!tenant.phone) {
            showNotification({ title: "Error", message: "El inquilino no tiene un número de teléfono." });
            return;
        }
        try {
            await sendWhatsAppCallable({ phoneNumber: tenant.phone, message });
            showNotification({ title: "Éxito", message: "Mensaje enviado a la cola de envío." });
        } catch (error) {
            console.error("Error sending message:", error);
            showNotification({ title: "Error", message: "No se pudo enviar el mensaje." });
        }
        setMessageModal({ isOpen: false, tenant: null });
    };

    const customTenantActions = (item) => (
        <Button onClick={(e) => { e.stopPropagation(); openMessageModal(item); }} variant="ghost" className="p-2 text-green-600" title="Enviar Mensaje WhatsApp">
            <Send size={16}/>
        </Button>
    );

    return (
        <>
            <CrudManager 
                title="Inquilinos" 
                collectionName="tenants" 
                fields={tenantFields} 
                {...props} 
                data={props.appData.tenants} 
                selectedItem={selectedItem}
                onSelectItem={setSelectedItem}
                renderItem={(renderProps) => renderTable({ ...renderProps, fields: tenantFields, itemType: 'Tenant', customActions: customTenantActions })} 
                renderDetailsPanel={(panelProps) => <DetailsPanel {...panelProps} itemType="Tenant" handlePaymentStatusChange={props.handlePaymentStatusChange} userProfile={props.userProfile} />}
            />
            {messageModal.isOpen && (
                <CustomMessageModal 
                    isOpen={messageModal.isOpen}
                    onClose={() => setMessageModal({ isOpen: false, tenant: null })}
                    tenant={messageModal.tenant}
                    onSend={handleSendMessage}
                />
            )}
        </>
    );
};

const CustomMessageModal = ({ isOpen, onClose, tenant, onSend }) => {
    const [message, setMessage] = useState('');
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Enviar Mensaje a ${tenant.name}`}>
            <div className="space-y-4">
                <Textarea 
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Escribe tu mensaje personalizado aquí..."
                    rows={5}
                />
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button onClick={() => onSend(tenant, message)} disabled={!message.trim()}>Enviar Mensaje</Button>
                </div>
            </div>
        </Modal>
    );
};

const ViewGeneratedContractsModal = ({ isOpen, onClose, rental, orgId, appData, userProfile }) => {
    const { libsLoaded } = useContext(LibsContext);
    const showNotification = useContext(NotificationContext);
    const [generatedContracts, setGeneratedContracts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedContract, setSelectedContract] = useState(null);

    useEffect(() => {
        if (!rental?.id || !orgId) return;
        setIsLoading(true);
        const contractsRef = collection(db, `organizations/${orgId}/rentals/${rental.id}/generatedContracts`);
        const q = query(contractsRef, orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const contractsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setGeneratedContracts(contractsData);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching generated contracts:", error);
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [rental, orgId]);

    const handleExportToWord = async (contract) => {
        if (!libsLoaded || !window.htmlDocx || !window.saveAs) {
            showNotification({title: "Error de Exportación", message: 'La librería para generar documentos de Word no se cargó correctamente.'});
            return;
        }
        const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${renderMarkdown(contract.content)}</body></html>`;
        const fileBlob = await window.htmlDocx.asBlob(htmlContent);
        window.saveAs(fileBlob, `contrato-${contract.templateName.replace(/ /g, '_')}.docx`);
    };

    const handleDeleteContract = async (contractId) => {
        const confirmed = await showNotification({title: "Confirmar", message: "¿Estás seguro de que quieres eliminar este contrato generado?", confirmText: "Eliminar", isDestructive: true});
        if (!confirmed) return;
        try {
            const contractRef = doc(db, `organizations/${orgId}/rentals/${rental.id}/generatedContracts`, contractId);
            await deleteDoc(contractRef);
            await addLogEntry(orgId, userProfile, 'DELETE_GENERATED_CONTRACT', 'Contratos', { rentalId: rental.id, generatedContractId: contractId });
            if(selectedContract?.id === contractId) {
                setSelectedContract(null);
            }
        } catch (error) {
            showNotification({title: "Error", message: "No se pudo eliminar el contrato."});
        }
    };

    if (selectedContract) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={`Viendo: ${selectedContract.templateName}`} size="4xl">
                 <div className="flex items-center justify-between mb-4">
                     <Button onClick={() => setSelectedContract(null)} variant="outline">
                         <ArrowLeft className="mr-2 h-4 w-4"/> Volver a la lista
                     </Button>
                     <Button onClick={() => handleExportToWord(selectedContract)} variant="outline" disabled={!libsLoaded}>
                         <FileDown className="mr-2 h-4 w-4"/> Exportar a Word
                     </Button>
                 </div>
                <div className="prose prose-sm max-w-full h-[60vh] overflow-y-auto bg-gray-50 p-4 border rounded-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedContract.content) }}></div>
            </Modal>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Contratos Generados para ${findById(appData.tenants, rental?.tenantId)?.name || 'N/A'}`} size="2xl">
            {isLoading && <div className="flex justify-center p-8"><Spinner/></div>}
            {!isLoading && generatedContracts.length === 0 && (
                 <EmptyState icon={FileText} title="Sin Documentos" message="No se han generado contratos para este alquiler." />
            )}
            {!isLoading && generatedContracts.length > 0 && (
                <ul className="divide-y divide-gray-200">
                    {generatedContracts.map(contract => (
                        <li key={contract.id} className="py-3 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-800">{contract.templateName}</p>
                                <p className="text-xs text-gray-500">Generado el: {formatDate(contract.createdAt, true)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button onClick={() => setSelectedContract(contract)} variant="outline">Ver</Button>
                                <Button onClick={() => handleDeleteContract(contract.id)} variant="ghost" className="text-red-500 p-2" title="Eliminar">
                                    <Trash2 size={16}/>
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
};

const RentalsPage = (props) => {
    const { libsLoaded } = useContext(LibsContext);
    const showNotification = useContext(NotificationContext);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedRental, setSelectedRental] = useState(null);

    const openViewModal = (rental) => {
        setSelectedRental(rental);
        setIsViewModalOpen(true);
    };

    const customRentalActions = (item) => (
        <>
            <Button onClick={(e) => { e.stopPropagation(); openViewModal(item); }} variant="ghost" className="p-2 text-green-600" title="Ver Documentos Generados">
                <FileCheck size={16}/>
            </Button>
            <Button onClick={(e) => { e.stopPropagation(); generateContractPDF(item) }} variant="ghost" className="p-2 text-blue-600" title="Descargar Resumen PDF" disabled={!libsLoaded}>
                <Download size={16}/>
            </Button>
        </>
    );

    const generateContractPDF = (item) => {
        if (!libsLoaded) {
            showNotification({title: "Error", message: 'Librerías de exportación no cargadas.'});
            return;
        }
        const property = findById(props.appData.properties, item.propertyId);
        const tenant = findById(props.appData.tenants, item.tenantId);
        
        const doc = new window.jspdf.jsPDF();
        doc.setFontSize(22);
        doc.setFont("helvetica", "bold");
        doc.text("Resumen de Contrato de Alquiler", 105, 20, { align: 'center' });

        doc.setFontSize(12);
        doc.setFont("helvetica", "normal");
        let y = 40;
        const addLine = (label, value) => {
            doc.setFont("helvetica", "bold");
            doc.text(label, 14, y);
            doc.setFont("helvetica", "normal");
            doc.text(String(value || 'N/A'), 60, y);
            y += 10;
        };
        
        addLine("Propiedad:", property.name);
        addLine("Dirección:", property.address);
        addLine("Inquilino:", tenant.name);
        addLine("Email Inquilino:", tenant.email);
        addLine("Teléfono Inquilino:", tenant.phone);
        y += 5;
        addLine("Fecha de Inicio:", formatDate(item.startDate));
        addLine("Fecha de Finalización:", formatDate(item.endDate));
        addLine("Monto de Alquiler:", `S/ ${parseFloat(item.rentAmount).toFixed(2)}`);
        addLine("Estado del Contrato:", item.status);
        
        y += 15;
        doc.setFontSize(10);
        doc.text("Este documento es un resumen generado por el sistema.", 105, y, { align: 'center', maxWidth: 180 });

        doc.save(`resumen-${tenant.name}-${property.name}.pdf`);
    };

    return (
        <>
            <CrudManager 
                title="Contratos" 
                collectionName="rentals" 
                fields={rentalFields} 
                {...props} 
                data={props.appData.rentals} 
                renderItem={(renderProps) => renderTable({ ...renderProps, fields: rentalFields.filter(f => f.type !== 'textarea'), itemType: 'Rental', customActions: customRentalActions })}
            />
            {isViewModalOpen && (
                <ViewGeneratedContractsModal
                    isOpen={isViewModalOpen}
                    onClose={() => setIsViewModalOpen(false)}
                    rental={selectedRental}
                    orgId={props.orgId}
                    appData={props.appData}
                    userProfile={props.userProfile}
                />
            )}
        </>
    );
};

const PaymentsPage = (props) => {
    const [filter, setFilter] = useState({ property: '', tenant: '' });
    const [activeDateFilter, setActiveDateFilter] = useState(null);
    const showNotification = useContext(NotificationContext);
    const sendWhatsAppCallable = httpsCallable(functions, 'sendWhatsApp');

    const handlePaymentStatusChangeAndNotify = async (payment, newStatus) => {
        await props.handlePaymentStatusChange(payment, newStatus);
        if (newStatus === 'Pagado') {
            const tenant = findById(props.appData.tenants, payment.tenantId);
            const message = `Hola ${tenant.name}, te confirmamos la recepción de tu pago por el concepto de "${payment.concept}" por un monto de S/ ${payment.amount}. ¡Gracias!`;
            
            try {
                await sendWhatsAppCallable({ phoneNumber: tenant.phone, message });
                showNotification({ title: "Notificación Enviada", message: "Se ha enviado la confirmación de pago al inquilino." });
            } catch (error) {
                console.error("Error sending WhatsApp notification:", error);
                showNotification({ title: "Error de Notificación", message: "No se pudo enviar la notificación de WhatsApp." });
            }
        }
    };

    const filteredPayments = useMemo(() => {
        let basePayments = props.appData.payments || [];

        let textualFiltered = basePayments;
        if (filter.property) {
            textualFiltered = textualFiltered.filter(p => p.propertyId === filter.property);
        }
        if (filter.tenant) {
            textualFiltered = textualFiltered.filter(p => p.tenantId === filter.tenant);
        }

        if (activeDateFilter) {
            const now = new Date();
            const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            
            return textualFiltered.filter(p => {
                if (!p.paymentDate || p.status !== 'Pendiente') return false;
                
                const paymentDate = new Date(`${p.paymentDate}T00:00:00Z`);

                if (activeDateFilter === 'overdue') {
                    return paymentDate < todayStart;
                }
                if (activeDateFilter === 'pending_this_month') {
                    const paymentMonth = paymentDate.getUTCMonth();
                    const paymentYear = paymentDate.getUTCFullYear();
                    const currentMonth = now.getUTCMonth();
                    const currentYear = now.getUTCFullYear();
                    return paymentYear === currentYear && paymentMonth === currentMonth;
                }
                return false;
            }).sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
        }

        return textualFiltered.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    }, [props.appData.payments, filter.property, filter.tenant, activeDateFilter]);

    const availableTenants = useMemo(() => {
        if (!filter.property) return props.appData.tenants || [];
        const tenantIds = new Set((props.appData.rentals || [])
            .filter(r => r.propertyId === filter.property)
            .map(r => r.tenantId));
        return (props.appData.tenants || []).filter(t => tenantIds.has(t.id));
    }, [filter.property, props.appData.tenants, props.appData.rentals]);

    const handleClearFilters = () => {
        setFilter({ property: '', tenant: '' });
        setActiveDateFilter(null);
    }

    return (
        <div>
            <Card className="mb-6">
                 <CardContent>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                          <div>
                              <label className="block text-sm font-medium mb-1">Filtrar por Propiedad</label>
                              <Select value={filter.property} onChange={e => { setFilter({ property: e.target.value, tenant: '' }); }}>
                                  <option value="">Todas las propiedades</option>
                                  {props.appData.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </Select>
                          </div>
                         <div>
                              <label className="block text-sm font-medium mb-1">Filtrar por Inquilino</label>
                              <Select value={filter.tenant} onChange={e => { setFilter(f => ({ ...f, tenant: e.target.value })); }} >
                                  <option value="">Todos los inquilinos</option>
                                  {availableTenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </Select>
                          </div>
                          <Button variant={activeDateFilter === 'overdue' ? 'default' : 'outline'} onClick={() => setActiveDateFilter(activeDateFilter === 'overdue' ? null : 'overdue')}>Vencidos</Button>
                          <Button variant={activeDateFilter === 'pending_this_month' ? 'default' : 'outline'} onClick={() => setActiveDateFilter(activeDateFilter === 'pending_this_month' ? null : 'pending_this_month')}>Pendientes del Mes</Button>
                          <div>
                              <Button variant="outline" onClick={handleClearFilters} className="w-full">Limpiar Filtros</Button>
                          </div>
                      </div>
                 </CardContent>
            </Card>
            <CrudManager 
                title="Pagos" 
                collectionName="payments" 
                fields={paymentFields} 
                {...props} 
                data={filteredPayments}
                renderItem={(renderProps) => renderTable({ ...renderProps, fields: paymentFields, itemType: 'Payment', handleStatusChange: handlePaymentStatusChangeAndNotify, userProfile: props.userProfile })}
            />
        </div>
    );
};

const ExpensesPage = (props) => <CrudManager title="Gastos" collectionName="expenses" fields={expenseFields} {...props} data={props.appData.expenses} renderItem={(renderProps) => renderTable({ ...renderProps, fields: expenseFields, itemType: 'Expense', handleStatusChange: props.handleExpenseStatusChange, userProfile: props.userProfile })}/>;

const MaintenancePage = (props) => {
    const priorityColors = {
        'Baja': 'bg-blue-100 text-blue-800',
        'Media': 'bg-yellow-100 text-yellow-800',
        'Alta': 'bg-orange-100 text-orange-800',
        'Urgente': 'bg-red-100 text-red-800',
    };

    const maintenanceTableFields = [
        { name: 'propertyId', label: 'Propiedad', render: (item, data) => findById(data.properties, item.propertyId).name }, 
        { name: 'description', label: 'Descripción' }, 
        { name: 'priority', label: 'Prioridad', render: (item) => <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${priorityColors[item.priority] || 'bg-gray-100 text-gray-800'}`}>{item.priority}</span> },
        { name: 'status', label: 'Estado', render: (item) => <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.status === 'Completado' ? 'bg-green-100 text-green-800' : item.status === 'En Progreso' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{item.status}</span>}
    ];

    return (
        <CrudManager 
            title="Mantenimientos" 
            collectionName="maintenance" 
            fields={maintenanceFields} 
            {...props} 
            data={props.appData.maintenance} 
            renderItem={(renderProps) => renderTable({ ...renderProps, fields: maintenanceTableFields, itemType: 'Maintenance' })}
        />
    );
};

const GenerateContractModal = ({ isOpen, onClose, template, appData, orgId, userProfile, organizationData }) => {
    const [selectedRentalId, setSelectedRentalId] = useState('');
    const [generatedContent, setGeneratedContent] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const showNotification = useContext(NotificationContext);

    const activeRentals = useMemo(() => (appData.rentals || []).filter(r => r.status === 'Activo'), [appData.rentals]);

    const handleGenerate = async () => {
        if (!selectedRentalId) {
            showNotification({title: "Error", message: "Por favor, selecciona un contrato de alquiler."});
            return;
        }
        setIsGenerating(true);

        const rental = findById(appData.rentals, selectedRentalId);
        const tenant = findById(appData.tenants, rental.tenantId);
        const property = findById(appData.properties, rental.propertyId);

        const prompt = `
            Actúa como un asistente legal experto. A continuación te proporciono una plantilla de contrato y los datos específicos de un nuevo alquiler.
            Tu tarea es tomar la plantilla y rellenarla con los datos proporcionados para generar un contrato finalizado y personalizado.
            Asegúrate de reemplazar todos los placeholders (ej. [NOMBRE_INQUILINO], [DIRECCION_PROPIEDAD]) con la información correcta.
            Valida que la dirección de la propiedad sea coherente y esté bien formada.
            El resultado debe ser únicamente el texto completo del contrato nuevo en formato Markdown.
        `;
        const context = {
            plantilla: template.content,
            datos_del_alquiler: {
                "[NOMBRE_INQUILINO]": tenant.name,
                "[DNI_INQUILINO]": tenant.dni,
                "[DOMICILIO_INQUILINO]": tenant.domicilio,
                "[EMAIL_INQUILINO]": tenant.email,
                "[TELEFONO_INQUILINO]": tenant.phone,
                "[NOMBRE_PROPIEDAD]": property.name,
                "[DIRECCION_PROPIEDAD]": property.address,
                "[DESCRIPCION_DETALLADA_INMUEBLE]": property.detailedDescription || 'No especificada',
                "[DETALLES_DEPARTAMENTO]": rental.departmentDetails || 'No especificado',
                "[TIPO_PROPIEDAD]": property.type,
                "[FECHA_INICIO_CONTRATO]": formatDate(rental.startDate),
                "[FECHA_FIN_CONTRATO]": formatDate(rental.endDate),
                "[MONTO_ALQUILER_NUMERO]": rental.rentAmount,
            }
        };

        const { success, data } = await callAIGenerator(prompt, organizationData?.geminiApiKey, context);
        if (success) {
            setGeneratedContent(data);
        } else {
            showNotification({title: "Error de IA", message: data});
        }
        setIsGenerating(false);
    };
    
    const handleSave = async () => {
        if (!generatedContent || !selectedRentalId) {
            showNotification({title: "Error", message: "No hay contenido generado para guardar o no se ha seleccionado un alquiler."});
            return;
        }
        setIsSaving(true);
        try {
            const rentalRef = doc(db, `organizations/${orgId}/rentals`, selectedRentalId);
            const generatedContractData = {
                content: generatedContent,
                templateId: template.id,
                templateName: template.name,
                rentalId: selectedRentalId,
                createdAt: new Date().toISOString(),
                createdBy: userProfile.email,
            };
            await addDoc(collection(rentalRef, 'generatedContracts'), generatedContractData);
            await addLogEntry(orgId, userProfile, 'GENERATE_CONTRACT_FROM_TEMPLATE', 'Plantillas', { rentalId: selectedRentalId, templateId: template.id });
            showNotification({title: "Éxito", message: "Contrato generado y guardado exitosamente."});
            onClose();
        } catch (error) {
            console.error("Error al guardar el contrato generado:", error);
            showNotification({title: "Error", message: "Hubo un error al guardar el contrato."});
        }
        setIsSaving(false);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Generar Contrato desde: "${template?.name}"`} size="6xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <Card>
                        <CardHeader><CardTitle>1. Selecciona el Alquiler</CardTitle></CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-600 mb-2">Elige el contrato activo para el cual se generará este documento.</p>
                            <Select value={selectedRentalId} onChange={e => setSelectedRentalId(e.target.value)}>
                                <option value="" disabled>Seleccionar un alquiler...</option>
                                {activeRentals.map(r => {
                                    const tenant = findById(appData.tenants, r.tenantId);
                                    const property = findById(appData.properties, r.propertyId);
                                    return <option key={r.id} value={r.id}>{tenant.name} en {property.name}</option>
                                })}
                            </Select>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>2. Genera con IA</CardTitle></CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-600 mb-4">La IA usará la plantilla y los datos del alquiler para crear el contrato. Podrás revisarlo antes de guardar.</p>
                            <Button className="w-full" onClick={handleGenerate} disabled={!selectedRentalId || isGenerating || !organizationData?.geminiApiKey}>
                                {isGenerating ? <><Spinner className="mr-2"/> Generando...</> : <><Sparkles className="mr-2 h-4 w-4"/>Generar Contrato</>}
                            </Button>
                             {!organizationData?.geminiApiKey && <p className="text-xs text-red-500 mt-2">Se requiere una clave de API de Gemini. Ve a Ajustes.</p>}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>3. Guarda el Documento</CardTitle></CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-600 mb-4">Una vez revisado, guarda el contrato. Quedará asociado al alquiler seleccionado.</p>
                            <Button className="w-full" variant="success" onClick={handleSave} disabled={!generatedContent || isSaving}>
                                {isSaving ? <><Spinner className="mr-2"/> Guardando...</> : <><CheckCircle className="mr-2 h-4 w-4"/>Guardar Contrato Final</>}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-lg mb-2">Contrato Generado</h3>
                    {isGenerating && <div className="flex justify-center items-center h-full"><Spinner className="h-8 w-8"/></div>}
                    {!isGenerating && generatedContent && (
                         <div className="prose prose-sm max-w-full h-[55vh] overflow-y-auto bg-white p-4 border rounded-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(generatedContent) }}></div>
                    )}
                     {!isGenerating && !generatedContent && (
                         <div className="flex justify-center items-center h-full text-center text-gray-500">
                             <p>El contenido del contrato aparecerá aquí después de generarlo.</p>
                         </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};

const ContractTemplatesPage = (props) => {
    const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);

    const openGenerator = (template) => {
        setSelectedTemplate(template);
        setIsGeneratorOpen(true);
    };
    
    const closeGenerator = () => {
        setSelectedTemplate(null);
        setIsGeneratorOpen(false);
    };

    const customActions = (item) => (
        <Button onClick={(e) => { e.stopPropagation(); openGenerator(item); }} variant="outline" className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs px-2 py-1 gap-1">
            <FilePlus size={14}/> Usar
        </Button>
    );

    return (
        <div>
            <CrudManager
                title="Plantillas de Contrato"
                collectionName="contractTemplates"
                fields={templateFields}
                {...props}
                data={props.appData.contractTemplates}
                renderItem={(renderProps) => renderTable({
                    ...renderProps,
                    fields: templateFields.filter(f => f.name !== 'content'),
                    itemType: 'Template',
                    customActions,
                })}
            />
            {isGeneratorOpen && (
                <GenerateContractModal 
                    isOpen={isGeneratorOpen}
                    onClose={closeGenerator}
                    template={selectedTemplate}
                    appData={props.appData}
                    orgId={props.orgId}
                    userProfile={props.userProfile}
                    organizationData={props.organizationData}
                />
            )}
        </div>
    );
};

const SettingsPage = ({ userProfile, organizationData }) => {
    const [settings, setSettings] = useState({
        geminiApiKey: organizationData?.geminiApiKey || '',
        managerPhoneNumber: organizationData?.managerPhoneNumber || ''
    });
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    useEffect(() => {
        setSettings({
            geminiApiKey: organizationData?.geminiApiKey || '',
            managerPhoneNumber: organizationData?.managerPhoneNumber || ''
        });
    }, [organizationData]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setSettings(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveMessage('');
        try {
            const orgDocRef = doc(db, 'organizations', userProfile.orgId);
            await updateDoc(orgDocRef, { 
                geminiApiKey: settings.geminiApiKey,
                managerPhoneNumber: settings.managerPhoneNumber
            });
            setSaveMessage('¡Ajustes guardados correctamente!');
        } catch (error) {
            console.error("Error al guardar los ajustes:", error);
            setSaveMessage('Error al guardar los ajustes. Inténtalo de nuevo.');
        }
        setIsSaving(false);
        setTimeout(() => setSaveMessage(''), 3000);
    };

    return (
        <div>
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Ajustes</h1>
            <form onSubmit={handleSave}>
                <Card className="mb-6">
                    <CardHeader><CardTitle>Configuración de API de IA</CardTitle></CardHeader>
                    <CardContent>
                        <div>
                            <label htmlFor="gemini-api-key" className="text-sm font-medium">Clave de API de Google Gemini</label>
                            <p className="text-xs text-gray-500 mb-2">Esta clave es necesaria para todas las funciones de inteligencia artificial.</p>
                            <Input id="gemini-api-key" name="geminiApiKey" type="password" value={settings.geminiApiKey} onChange={handleInputChange} placeholder="Ingresa tu clave de API aquí" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Configuración de Comunicaciones</CardTitle></CardHeader>
                    <CardContent>
                        <div>
                            <label htmlFor="manager-phone" className="text-sm font-medium">Número de WhatsApp del Gestor</label>
                            <p className="text-xs text-gray-500 mb-2">Incluye el código de país. Ej: 51987654321</p>
                            <Input id="manager-phone" name="managerPhoneNumber" type="tel" value={settings.managerPhoneNumber} onChange={handleInputChange} placeholder="Número para contacto de inquilinos" />
                        </div>
                    </CardContent>
                </Card>
                <div className="flex items-center gap-4 mt-6">
                    <Button type="submit" disabled={isSaving}>
                        {isSaving ? <Spinner /> : 'Guardar Ajustes'}
                    </Button>
                    {saveMessage && <p className={`text-sm ${saveMessage.includes('Error') ? 'text-red-500' : 'text-green-600'}`}>{saveMessage}</p>}
                </div>
            </form>
        </div>
    );
};

// --- Proveedor de Notificaciones Toast ---
const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const showToast = useCallback((message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(currentToasts => currentToasts.filter(t => t.id !== id));
        }, 5000);
    }, []);
    
    const removeToast = (id) => {
        setToasts(currentToasts => currentToasts.filter(t => t.id !== id));
    };

    return (
        <ToastContext.Provider value={showToast}>
            {children}
            <div className="fixed top-4 right-4 z-[100] space-y-2">
                {toasts.map(toast => (
                    <div key={toast.id} className="max-w-sm w-full bg-white shadow-lg rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5 overflow-hidden">
                        <div className="p-4">
                            <div className="flex items-start">
                                <div className="flex-shrink-0">
                                    <Info className="h-6 w-6 text-blue-400" />
                                </div>
                                <div className="ml-3 w-0 flex-1 pt-0.5">
                                    <p className="text-sm font-medium text-gray-900">Nueva Notificación</p>
                                    <p className="mt-1 text-sm text-gray-500">{toast.message}</p>
                                </div>
                                <div className="ml-4 flex-shrink-0 flex">
                                    <button onClick={() => removeToast(toast.id)} className="bg-white rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                                        <span className="sr-only">Close</span>
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

// --- Proveedor de Alertas y Confirmaciones ---
const NotificationProvider = ({ children }) => {
    const [notification, setNotification] = useState({ isOpen: false });
    const resolveRef = useRef(null);

    const showNotification = useCallback((options) => {
        setNotification({ isOpen: true, ...options });
        return new Promise((resolve) => {
            resolveRef.current = resolve;
        });
    }, []);

    const handleClose = () => {
        if (resolveRef.current) {
            resolveRef.current(false);
        }
        setNotification({ isOpen: false });
    };

    const handleConfirm = () => {
        if (resolveRef.current) {
            resolveRef.current(true);
        }
        setNotification({ isOpen: false });
    };

    return (
        <NotificationContext.Provider value={showNotification}>
            {children}
            <Modal isOpen={notification.isOpen} onClose={handleClose} title={notification.title || 'Notificación'} size="sm">
                <div className="text-center">
                    {notification.isDestructive ? <AlertTriangle className="mx-auto h-12 w-12 text-red-500" /> : <Info className="mx-auto h-12 w-12 text-blue-500" />}
                    <p className="mt-4 text-gray-600">{notification.message}</p>
                </div>
                <div className="flex justify-center gap-4 mt-6">
                    {notification.confirmText && <Button variant="outline" onClick={handleClose}>Cancelar</Button>}
                    <Button variant={notification.isDestructive ? 'destructive' : 'default'} onClick={handleConfirm}>
                        {notification.confirmText || 'Aceptar'}
                    </Button>
                </div>
            </Modal>
        </NotificationContext.Provider>
    );
};


// --- Componente Principal de la Aplicación ---
function AppContent() {
    const [userProfile, setUserProfile] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [appData, setAppData] = useState({ properties: [], tenants: [], rentals: [], payments: [], maintenance: [], expenses: [], logs: [], contractTemplates: [] });
    const [organizationData, setOrganizationData] = useState(null);
    const [activePage, setActivePage] = useState('dashboard');
    const showToast = useContext(ToastContext);
    
    const maintenanceRef = useRef([]);
    const appDataRef = useRef(appData);
    const isInitialLoad = useRef(true);

    useEffect(() => {
        appDataRef.current = appData;
    }, [appData]);
    
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setIsLoading(true);
            if (user) {
                try {
                    const userDocRef = doc(db, 'users', user.uid);
                    const docSnap = await getDoc(userDocRef);
                    
                    if (docSnap.exists()) {
                        setUserProfile({ ...docSnap.data(), uid: user.uid, email: user.email });
                    } else {
                        const tenantsCollectionGroup = collectionGroup(db, 'tenants');
                        const tenantQuery = query(tenantsCollectionGroup, where('uid', '==', user.uid));
                        const tenantQuerySnapshot = await getDocs(tenantQuery);

                        if (!tenantQuerySnapshot.empty) {
                            const tenantDoc = tenantQuerySnapshot.docs[0];
                            const orgId = tenantDoc.ref.parent.parent.id;
                            setUserProfile({
                                email: user.email,
                                uid: user.uid,
                                role: 'Tenant',
                                tenantDocId: tenantDoc.id,
                                orgId: orgId
                            });
                        } else {
                            console.log("Usuario autenticado pero sin perfil válido. Cerrando sesión.");
                            signOut(auth).catch(console.error);
                            setUserProfile(null);
                        }
                    }
                } catch (error) {
                    console.error("Error al obtener el perfil del usuario:", error);
                    signOut(auth).catch(console.error);
                    setUserProfile(null);
                }
            } else {
                setUserProfile(null);
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!userProfile?.orgId || !showToast) {
            setAppData({ properties: [], tenants: [], rentals: [], payments: [], maintenance: [], expenses: [], logs: [], contractTemplates: [] });
            setOrganizationData(null);
            return;
        }

        const orgId = userProfile.orgId;
        const orgDocRef = doc(db, 'organizations', orgId);
        const unsubOrg = onSnapshot(orgDocRef, (docSnap) => {
            if (docSnap.exists()) setOrganizationData(docSnap.data());
        });

        if (userProfile.role === 'Tenant') {
            return () => unsubOrg();
        }

        const collectionsToWatch = ['properties', 'tenants', 'rentals', 'payments', 'maintenance', 'expenses', 'logs', 'contractTemplates'];
        
        const unsubscribers = collectionsToWatch.map(cName => {
            const collRef = collection(db, `organizations/${orgId}/${cName}`);
            const q = cName === 'logs' 
                ? query(collRef, orderBy('timestamp', 'desc')) 
                : query(collRef);

            return onSnapshot(q, (querySnapshot) => {
                const data = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
                
                if (cName === 'maintenance') {
                    if (!isInitialLoad.current) {
                        const oldIds = new Set(maintenanceRef.current.map(m => m.id));
                        const newItems = data.filter(item => !oldIds.has(item.id));
                        newItems.forEach(item => {
                            const property = findById(appDataRef.current.properties, item.propertyId);
                            showToast(`Nueva solicitud para: ${property?.name || 'Propiedad Desconocida'}`);
                        });
                    }
                    maintenanceRef.current = data;
                }

                setAppData(prev => ({ ...prev, [cName]: data }));
            }, (error) => console.error(`Error escuchando a ${cName}:`, error));
        });
        
        setTimeout(() => { isInitialLoad.current = false; }, 3000);

        return () => {
            unsubscribers.forEach(unsub => unsub());
            unsubOrg();
        };
    }, [userProfile?.orgId, showToast]);

    const handleLogout = async () => {
        await signOut(auth);
    };

    const handlePaymentStatusChange = async (payment, newStatus) => {
        if (!userProfile?.orgId) return;
        const paymentRef = doc(db, `organizations/${userProfile.orgId}/payments`, payment.id);
        try {
            const before = { status: payment.status };
            const after = { status: newStatus };
            await updateDoc(paymentRef, after);
            await addLogEntry(userProfile.orgId, userProfile, 'UPDATE_PAYMENT_STATUS', 'Pagos', {
                paymentId: payment.id, before, after
            });
        } catch (error) {
            console.error("Error updating payment status: ", error);
        }
    };
    
    const handleExpenseStatusChange = async (expense, newStatus) => {
        if (!userProfile?.orgId) return;
        const expenseRef = doc(db, `organizations/${userProfile.orgId}/expenses`, expense.id);
        try {
            const before = { status: expense.status };
            const after = { status: newStatus };
            await updateDoc(expenseRef, after);
            await addLogEntry(userProfile.orgId, userProfile, 'UPDATE_EXPENSE_STATUS', 'Gastos', {
                expenseId: expense.id, before, after
            });
        } catch (error) {
            console.error("Error updating expense status: ", error);
        }
    };

    const AdminPortal = ({ pendingMaintenanceCount }) => {
        const [libsLoaded, setLibsLoaded] = useState(false);
        const [libsError, setLibsError] = useState(null);

        useEffect(() => {
            const scripts = [
                "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
                "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
                "https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js",
                "https://cdn.jsdelivr.net/npm/html-to-docx@1.8.0/dist/html-to-docx.js"
            ];

            const loadScript = (src) => new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    return resolve();
                }
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.onload = resolve;
                script.onerror = () => reject(new Error(`No se pudo cargar el script: ${src}`));
                document.head.appendChild(script);
            });

            Promise.all(scripts.map(loadScript))
                .then(() => setLibsLoaded(true))
                .catch(err => {
                    console.error("Fallo al cargar las librerías externas:", err.message);
                    setLibsError(err.message);
                });
        }, []);

        const navLinks = [
            { icon: Home, label: "Panel Principal", page: "dashboard" },
            { icon: Building2, label: "Propiedades", page: "properties" },
            { icon: Users, label: "Inquilinos", page: "tenants" },
            { icon: FileCheck, label: "Contratos", page: "rentals" },
            { icon: FileText, label: "Plantillas", page: "templates" },
            { icon: DollarSign, label: "Pagos", page: "payments" },
            { icon: TrendingDown, label: "Gastos", page: "expenses" },
            { icon: Wrench, label: "Mantenimiento", page: "maintenance" },
            { icon: BrainCircuit, label: "Co-piloto IA", page: "ai_copilot" },
            { icon: Users2, label: "Equipo", page: "team", roles: ["Admin"] },
            { icon: Clock, label: "Actividad", page: "logs", roles: ["Admin"] },
            { icon: KeyRound, label: "Ajustes", page: "settings" },
        ];
        const allowedLinks = navLinks.filter(link => !link.roles || link.roles.includes(userProfile.role));
        
        const renderPage = () => {
            const pageProps = { appData, organizationData, orgId: userProfile.orgId, userProfile, handlePaymentStatusChange, handleExpenseStatusChange };
            switch (activePage) {
                case 'dashboard': return <Dashboard {...pageProps} />;
                case 'properties': return <PropertiesPage {...pageProps} />;
                case 'tenants': return <TenantsPage {...pageProps} />;
                case 'rentals': return <RentalsPage {...pageProps} />;
                case 'templates': return <ContractTemplatesPage {...pageProps} />;
                case 'payments': return <PaymentsPage {...pageProps} />;
                case 'expenses': return <ExpensesPage {...pageProps} />;
                case 'maintenance': return <MaintenancePage {...pageProps} />;
                case 'ai_copilot': return <AiCoPilotPage {...pageProps} />;
                case 'team': return <TeamPage {...pageProps} />;
                case 'logs': return <ActivityLogPage {...pageProps} />;
                case 'settings': return <SettingsPage userProfile={userProfile} organizationData={organizationData} />;
                default: return <EmptyState icon={Building2} title="Página no encontrada"/>;
            }
        };

        const NavLink = ({ icon: Icon, label, page, badge }) => (
            <button onClick={() => setActivePage(page)} className={`flex items-center w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors relative ${activePage === page ? 'bg-slate-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <Icon className="mr-3 h-5 w-5" />
                <span>{label}</span>
                {badge > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center h-5 w-5 text-xs font-semibold rounded-full bg-red-600 text-white">
                        {badge}
                    </span>
                )}
            </button>
        );
        
        return (
            <LibsContext.Provider value={{ libsLoaded }}>
                <div className="flex h-screen bg-gray-50 font-sans">
                    <aside className="w-64 flex-shrink-0 bg-white border-r p-4 flex flex-col justify-between">
                        <div>
                            <div className="flex items-center gap-2 px-4 mb-6"><Building2 className="h-8 w-8 text-slate-900" /><h2 className="text-xl font-bold">GestorPro</h2></div>
                            <nav className="space-y-1">
                                {allowedLinks.map(link => (
                                    <NavLink 
                                        key={link.page} 
                                        {...link} 
                                        badge={link.page === 'maintenance' ? pendingMaintenanceCount : 0}
                                    />
                                ))}
                            </nav>
                        </div>
                        <div className="px-2 pt-4 border-t">
                            <p className="text-sm font-semibold truncate">{userProfile.email}</p>
                            <p className="text-xs text-gray-500">Rol: {userProfile.role}</p>
                            <Button variant="ghost" className="w-full justify-start mt-2" onClick={handleLogout}><LogOut className="mr-2" size={16}/>Cerrar Sesión</Button>
                        </div>
                    </aside>
                    <main className="flex-1 overflow-y-auto p-8">
                        {libsError && (
                            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md" role="alert">
                                <p className="font-bold">Error de Carga</p>
                                <p>No se pudieron cargar algunas librerías externas. La exportación de documentos podría no funcionar.</p>
                            </div>
                        )}
                        {renderPage()}
                    </main>
                </div>
            </LibsContext.Provider>
        );
    }
    
    const pendingMaintenanceCount = useMemo(() => 
        appData.maintenance.filter(item => item.status === 'Pendiente').length, 
        [appData.maintenance]
    );

    if (isLoading) {
        return <FullPageLoader message="Verificando sesión..." />;
    }

    return (
        <>
            {!userProfile ? <AuthComponent /> : 
             userProfile.role === 'Tenant' ? <TenantPortal userProfile={userProfile} onLogout={handleLogout} organizationData={organizationData} /> :
             <AdminPortal pendingMaintenanceCount={pendingMaintenanceCount} />
            }
        </>
    );
}

const ImageViewerModal = ({ isOpen, onClose, images }) => {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Fotos de Evidencia" size="4xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {images.map((url, index) => (
                    <div key={index} className="w-full h-64 bg-gray-200 rounded-lg overflow-hidden">
                        <img src={url} alt={`Evidencia ${index + 1}`} className="w-full h-full object-cover" />
                    </div>
                ))}
            </div>
        </Modal>
    );
};

export default function App() {
    return (
        <NotificationProvider>
            <ToastProvider>
                <AppContent />
            </ToastProvider>
        </NotificationProvider>
    );
}
