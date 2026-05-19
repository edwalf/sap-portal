# SAP Portal — PWA para SAP Business One

Portal web progresivo (PWA) con login, consulta de existencias, órdenes de venta y saldos de clientes, conectado directamente al **SAP Business One Service Layer**.

---

## Estructura del proyecto

```
sap-portal/
├── backend/                  ← Servidor Node.js (proxy hacia SAP)
│   ├── config/
│   │   └── sap.js            ← Sesión con SAP Service Layer
│   ├── middleware/
│   │   └── auth.js           ← Validación JWT
│   ├── routes/
│   │   ├── auth.js           ← Login/logout del portal
│   │   ├── inventory.js      ← Existencias
│   │   ├── orders.js         ← Órdenes de venta
│   │   └── customers.js      ← Saldos de clientes
│   ├── scripts/
│   │   └── hash-password.js  ← Genera hashes para el .env
│   ├── server.js             ← Entry point Express
│   ├── package.json
│   └── .env.example          ← ⬅ COPIA ESTO COMO .env Y EDITA
│
└── frontend/                 ← PWA estática (servida por el backend)
    ├── index.html            ← App completa (single file)
    ├── manifest.json         ← PWA manifest
    ├── sw.js                 ← Service Worker
    ├── icon-192.png          ← (agregar manualmente)
    └── icon-512.png          ← (agregar manualmente)
```

---

## ⚡ Configuración en 5 pasos

### 1. Clonar e instalar

```bash
git clone https://github.com/tu-usuario/sap-portal.git
cd sap-portal/backend
npm install
```

### 2. Crear el archivo `.env`

```bash
cp .env.example .env
```

Abre `.env` y completa **solo estas líneas** con tus datos reales:

```env
SAP_HOST=192.168.1.100        # IP o hostname de tu servidor SAP B1
SAP_PORT=50000                 # Puerto del Service Layer
SAP_COMPANY=MI_EMPRESA_SA      # Nombre de tu base de datos en SAP
SAP_USER=manager               # Usuario SAP B1
SAP_PASSWORD=tu_password       # Contraseña SAP B1
SAP_HTTPS=true                 # true si SAP usa HTTPS (recomendado)

JWT_SECRET=pon_aqui_una_frase_larga_y_aleatoria_2024
```

### 3. Crear usuarios del portal

Genera un hash para cada contraseña:

```bash
node scripts/hash-password.js mipassword123
```

Copia el hash en el `.env`:

```env
PORTAL_USERS=admin:$2a$10$HASH_ADMIN,ventas:$2a$10$HASH_VENTAS
```

Formato: `usuario1:hash1,usuario2:hash2,usuario3:hash3`

### 4. Iniciar el servidor

```bash
# Producción
npm start

# Desarrollo (con hot-reload)
npm run dev
```

Al arrancar verás:
```
🚀 SAP Portal corriendo en http://localhost:3000
✅ Conexión SAP OK — Mi Empresa S.A.
```

### 5. Abrir en el navegador

```
http://localhost:3000
```

Listo. La PWA se puede instalar en el teléfono desde el navegador (Chrome/Edge → "Agregar a pantalla de inicio").

---

## API Endpoints

Todos los endpoints (excepto `/api/auth/login`) requieren header:
```
Authorization: Bearer <token>
```

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login del portal |
| GET | `/api/sap/ping` | Verifica conexión SAP |
| GET | `/api/inventory/item/:code` | Stock de un artículo |
| GET | `/api/inventory/search?q=X` | Buscar artículos |
| GET | `/api/inventory/all` | Todos los artículos |
| POST | `/api/orders` | Crear orden de venta |
| GET | `/api/orders` | Listar órdenes |
| GET | `/api/orders/:docEntry` | Detalle de orden |
| GET | `/api/customers/:code` | Datos + saldo de cliente |
| GET | `/api/customers/search?q=X` | Buscar clientes |
| GET | `/api/customers/:code/invoices` | Facturas pendientes |

---

## Despliegue en producción

### En un VPS (Ubuntu/Debian)

```bash
# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 para mantener el proceso activo
npm install -g pm2
cd sap-portal/backend
pm2 start server.js --name sap-portal
pm2 save
pm2 startup
```

### Variables importantes para producción

```env
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://tudominio.com   # Reemplaza * por tu dominio real
```

### Nginx como reverse proxy (opcional)

```nginx
server {
    listen 80;
    server_name tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Notas importantes

- **SAP Service Layer** debe estar activo en `https://HOST:50000/b1s/v1/`
- El backend ignora certificados SSL auto-firmados de SAP (normal en entornos locales)
- Las sesiones SAP se renuevan automáticamente cada 25 minutos
- El token JWT del portal expira en 8 horas (configurable en `.env`)
- En producción, usa HTTPS para el portal también

---

## Personalización

- **Agregar almacenes**: Edita la función `loadWarehouses()` en `frontend/index.html`  
- **Cambiar moneda**: Busca `GTQ` en `frontend/index.html`  
- **Agregar campos a la orden**: Edita `routes/orders.js` y el body del POST en el frontend  
- **Ajustar IVA**: Busca `*.12` en el frontend (actualmente 12% Guatemala)
