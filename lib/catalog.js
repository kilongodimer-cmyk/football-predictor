'use strict';

/**
 * Accès aux données de la boutique (catalogue, paramètres).
 * Cherche le dossier `data/` aussi bien en local que dans le bundle serverless.
 */

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');

function resolveDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    path.join(process.cwd(), 'data'),
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, 'data')
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'products.json'))) return dir;
    } catch {
      /* on essaie le candidat suivant */
    }
  }
  return candidates[1] || path.join(__dirname, '..', 'data');
}

const DATA_DIR = resolveDataDir();

// Copie embarquée dans le bundle (garantit la présence des données sur Vercel,
// même si l'inclusion de fichiers du déploiement change).
let embeddedCatalog = null;
let embeddedShop = null;
try {
  embeddedCatalog = require('../data/products.json');
} catch {
  /* dossier data absent du bundle */
}
try {
  embeddedShop = require('../data/shop.json');
} catch {
  /* idem */
}
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SHOP_FILE = path.join(DATA_DIR, 'shop.json');

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function getCatalog() {
  try {
    return await readJsonFile(PRODUCTS_FILE, embeddedCatalog || { categories: [], products: [] });
  } catch {
    return embeddedCatalog || { categories: [], products: [] };
  }
}

async function getShop() {
  try {
    return await readJsonFile(SHOP_FILE, embeddedShop || {});
  } catch {
    return embeddedShop || {};
  }
}

module.exports = {
  DATA_DIR,
  PRODUCTS_FILE,
  SHOP_FILE,
  readJsonFile,
  getCatalog,
  getShop
};
