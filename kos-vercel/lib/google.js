/**
 * Koneksi ke Google Sheets (database) dan Google Drive (penyimpanan file)
 * memakai Service Account. Kredensial diambil dari Environment Variable Vercel,
 * BUKAN dari login pengguna — jadi situs ini tidak pernah mengarahkan pengunjung
 * ke accounts.google.com atau script.google.com sama sekali.
 */
const { google } = require('googleapis');

const SHEET_KOS = 'Daftar_Kos';
const SHEET_DATA = 'Data_Penghuni';

function env(nama) {
  const v = process.env[nama];
  if (!v) throw new Error('Environment Variable "' + nama + '" belum diisi di pengaturan Vercel.');
  return v;
}

let _auth = null;
function auth() {
  if (_auth) return _auth;
  const email = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  // Private key disimpan di env var dengan \n literal (bukan baris baru asli), harus dikembalikan dulu.
  const key = env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  _auth = new google.auth.JWT(email, null, key, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ]);
  return _auth;
}

function sheets() {
  return google.sheets({ version: 'v4', auth: auth() });
}

function drive() {
  return google.drive({ version: 'v3', auth: auth() });
}

function spreadsheetId() {
  return env('SPREADSHEET_ID');
}

function driveFolderId() {
  return env('DRIVE_FOLDER_ID');
}

/* ---------------- Sheets: Daftar_Kos ---------------- */

async function ambilKos(kode) {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: SHEET_KOS + '!A2:F'
  });
  const rows = res.data.values || [];
  for (const r of rows) {
    if (String(r[0] || '').trim().toUpperCase() === kode) {
      return {
        kode: kode,
        nama: String(r[1] || ''),
        pengelola: String(r[2] || ''),
        wa: String(r[3] || ''),
        alamat: String(r[4] || ''),
        kamar: Number(r[5]) || 0
      };
    }
  }
  return null;
}

async function ambilSemuaKos() {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: SHEET_KOS + '!A2:F'
  });
  const rows = res.data.values || [];
  return rows
    .filter(function (r) { return r[0] && String(r[0]).trim(); })
    .map(function (r) {
      return {
        kode: String(r[0]).trim().toUpperCase(),
        nama: String(r[1] || ''),
        pengelola: String(r[2] || ''),
        wa: String(r[3] || ''),
        alamat: String(r[4] || ''),
        kamar: Number(r[5]) || 0
      };
    });
}

/* ---------------- Sheets: Data_Penghuni ---------------- */

async function ambilSemuaPenghuni() {
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: SHEET_DATA + '!A2:L'
  });
  return res.data.values || [];
}

async function tambahBarisPenghuni(baris) {
  await sheets().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: SHEET_DATA + '!A:L',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [baris] }
  });
}

/**
 * Mencari baris aktif berdasarkan ID + kode kos + NOMOR HP (ketiganya harus cocok — bukan ID saja,
 * supaya orang tidak bisa menebak ID siapa pun lalu "mengeluarkan" data orang lain), lalu set status
 * jadi "Keluar". Mengembalikan true kalau berhasil, false kalau tidak ditemukan/tidak cocok.
 * CATATAN: tidak ada penguncian lintas-proses (tidak seperti LockService di Apps Script);
 * kemungkinan dua klik "keluar" bersamaan pada baris yang sama bisa menulis dua kali — tidak
 * merusak data (hasil akhirnya sama), hanya duplikasi penulisan yang sangat jarang terjadi.
 */
async function keluarkanPenghuni(id, kode, hpTernormalisasi) {
  const { normHp } = require('./data');
  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: SHEET_DATA + '!A2:L'
  });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cocok = String(r[0]) === String(id) &&
      String(r[2] || '').trim().toUpperCase() === kode &&
      normHp(r[5]) === hpTernormalisasi &&
      String(r[8] || '') === 'Aktif';
    if (!cocok) continue;
    const baris = i + 2; // +2: offset header (baris 1) + array 0-based
    await sheets().spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: SHEET_DATA + '!I' + baris + ':J' + baris,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Keluar', new Date().toISOString()]] }
    });
    return true;
  }
  return false;
}

/* ---------------- Drive ---------------- */

/** Mengunggah satu file ke folder Drive yang ditentukan. Mengembalikan {id, url}. */
async function unggahFile(namaFile, mimeType, buffer) {
  const res = await drive().files.create({
    requestBody: { name: namaFile, parents: [driveFolderId()] },
    media: { mimeType: mimeType, body: bufferKeStream(buffer) },
    fields: 'id'
  });
  const id = res.data.id;
  return { id: id, url: 'https://drive.google.com/file/d/' + id + '/view' };
}

/** Mengunduh isi file Drive sebagai Buffer, untuk diteruskan ke dashboard Pak RT. */
async function unduhFile(fileId) {
  const meta = await drive().files.get({ fileId: fileId, fields: 'name,mimeType,trashed' });
  if (meta.data.trashed) throw new Error('TRASHED');
  const res = await drive().files.get({ fileId: fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return { buffer: Buffer.from(res.data), mimeType: meta.data.mimeType, nama: meta.data.name };
}

const { Readable } = require('stream');
function bufferKeStream(buffer) {
  const s = new Readable();
  s.push(buffer);
  s.push(null);
  return s;
}

module.exports = {
  ambilKos, ambilSemuaKos, ambilSemuaPenghuni, tambahBarisPenghuni, keluarkanPenghuni,
  unggahFile, unduhFile
};
