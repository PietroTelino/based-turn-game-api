import { prisma } from '../src/prisma';
import bcrypt from 'bcrypt';

async function main() {
    const godEmail = process.env.GOD_EMAIL ?? 'god@god.com';
    const godPassword = process.env.GOD_PASSWORD ?? 'adminadmin';

    if (!godEmail.includes('@')) {
        throw new Error('GOD_EMAIL inválido');
    }

    const passwordHash = await bcrypt.hash(godPassword, 10);

    const existing = await prisma.user.findUnique({
        where: { email: godEmail },
    });

    if (existing) {
        console.log(`Usuário GOD já existia (${existing.email}). Nada foi alterado.`);
        return;
    }

    await prisma.user.create({
        data: {
            name: 'God User',
            email: godEmail,
            password: passwordHash,
            role: 'god',
        },
    });

    console.log('Usuário GOD criado com sucesso!');
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
