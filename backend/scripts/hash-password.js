#!/usr/bin/env node
// scripts/hash-password.js
// Uso: node scripts/hash-password.js mipassword
// Genera el hash bcrypt para pegar en PORTAL_USERS del .env

const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/hash-password.js <password>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log('\nHash generado:');
console.log(hash);
console.log('\nEjemplo en .env:');
console.log(`PORTAL_USERS=admin:${hash}`);
