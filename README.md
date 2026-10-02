# TS Node API Template

A simple Node.js + TypeScript API template using Express, Prisma and PostgreSQL.  
This project is intended to be a reusable base for future APIs.

---

## 🧱 Tech Stack

- **Node.js** + **TypeScript**
- **Express 5**
- **Prisma ORM** (`@prisma/client` + `prisma`)
- **PostgreSQL** (`pg` + `@prisma/adapter-pg`)
- **JWT Authentication** (`jsonwebtoken`)
- **Password Hashing** (`bcrypt`)
- **Environment Variables** (`dotenv`)

---

## 📦 Requirements

- **Node.js** ≥ 18  
- **npm**, **yarn**, or **pnpm**
- **PostgreSQL** running locally or in Docker

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/ts-node-api-template.git
cd ts-node-api-template
```

### 2. Install dependencies

```bash
npm install
# or
yarn
# or
pnpm install
```

---

## ⚙️ Environment Variables

This project uses atomic database variables and automatically builds the
DATABASE_URL internally.

Create a .env file in the root directory based on .env.example.

### 1. Required variables
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=surveys-api-node-ts
DB_USER=postgres
DB_PASSWORD=root
```

The application will internally generate the following connection string:
```txt
postgresql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME?schema=public
```

This generated URL is used by:

• Prisma Client (runtime)

• Prisma migrations

• Prisma Studio

### 2. Required variables
If you prefer to define the connection string manually, you can still set:
```env
DATABASE_URL=postgresql://postgres:root@localhost:5432/surveys-api-node-ts?schema=public
```

### 3. Authentication (JWT)
```env
JWT_SECRET=your-access-token-secret
JWT_EXPIRES_IN_SECONDS=900            # 15 minutes

JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_REFRESH_EXPIRES_IN_SECONDS=604800 # 7 days
```

### 4. Seed User (GOD)
A privileged user can be created automatically via Prisma seed:
```env
GOD_EMAIL=god@god.com
GOD_PASSWORD=12345678
```
Run:
```bash
npm run seed
```

---

## 🗄️ Database Setup (Prisma + PostgreSQL)

### 1. Create the database

```bash
createdb <DB_NAME>
```

### 2. Run Prisma migrations (development)

```bash
npx prisma migrate dev
# or
npx prisma migrate dev --name init
```

### 3. Apply migrations (production or CI)

```bash
npx prisma migrate deploy
```

### 4. (Optional) Generate Prisma Client manually

```bash
npx prisma generate
```

### 5. (Optional) Open Prisma Studio

```bash
npx prisma studio
```

---

## 🏃 Running the Application

### 1. Development mode

```bash
npm run dev
```

### 2. Build the project

```bash
npm run build
```

### 3. Run compiled application

```bash
npm start
```

The server will run on the port defined in your `.env` file (default: **3000**).

---

## 📁 Project Structure

```txt
.
├── prisma
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.ts
│
├── src
│   ├── config
│   │   ├── env.ts
│   │   └── database.ts
│   │
│   ├── modules
│   │   ├── auth
│   │   ├── users
│   │   └── notifications
│   │
│   ├── routes
│   │   ├── index.ts
│   │   └── users.routes.ts
│   │
│   ├── app.ts
│   ├── prisma.ts
│   └── server.ts
│
├── .env
├── .env.example
├── prisma.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔑 Authentication Overview

The template includes:

- JWT Access & Refresh tokens  
- Password hashing with bcrypt  
- Auth middleware for protected routes  
- Auth controller, service and routes under `modules/auth`

You can modify or extend the authentication flow as needed.

---

## 🧪 Tests

No tests are included yet.

To add Jest later:

```bash
npm install --save-dev jest ts-jest @types/jest
```

Then update your `package.json`:

```json
"test": "jest"
```

---

## 🧹 Useful Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run migrations (development)
npx prisma migrate dev

# Apply migrations (production)
npx prisma migrate deploy

# Generate Prisma Client
npx prisma generate

# Build project
npm run build

# Start production server
npm start
```

---

## 📜 License

This project is licensed under the **ISC License**.  
Feel free to use and modify it for your own applications.
