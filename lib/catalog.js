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
  return readJsonFile(PRODUCTS_FILE, { categories: [], products: [] });
}

async function getShop() {
  return readJsonFile(SHOP_FILE, {});
}

module.exports = {
  DATA_DIR,
  PRODUCTS_FILE,
  SHOP_FILE,
  readJsonFile,
  getCatalog,
  getShop
};
