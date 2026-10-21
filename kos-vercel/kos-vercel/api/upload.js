const { validasiFile, bersihKode } = require('../lib/data');
const { unggahFile } = require('../lib/google');

const LABEL = { ktp: 'KTP', nikah: 'Buku Nikah', kk: 'KK' };
const EXT = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };

/**
 * POST { kode, label: 'ktp'|'nikah'|'kk', tipe, base64 }
 * Satu panggilan = satu file. Form mengirim KTP/Nikah/KK lewat 3 panggilan terpisah
 * (bukan digabung satu request besar) supaya tidak melebihi batas ukuran body
 * Vercel Serverless Function (~4.5 MB).
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, pesan: 'Metode tidak didukung.' });

  try {
    const body = req.body || {};
    const kode = bersihKode(body.kode);
    const label = LABEL[body.label] ? body.label : null;
    if (!kode || !label) return res.status(200).json({ ok: false, pesan: 'Permintaan tidak lengkap.' });

    const tipe = String(body.tipe || '');
    const base64 = String(body.base64 || '');
    if (!base64) return res.status(200).json({ ok: false, pesan: 'File ' + LABEL[label] + ' kosong.' });

    const buffer = Buffer.from(base64, 'base64');
    const v = validasiFile(tipe, buffer.length, LABEL[label]);
    if (!v.ok) return res.status(200).json(v);

    const ext = EXT[tipe] || '.bin';
    const namaFile = kode + '_' + label + '_' + Date.now() + ext;
    const hasil = await unggahFile(namaFile, tipe, buffer);

    res.status(200).json({ ok: true, fileId: hasil.id, url: hasil.url });
  } catch (err) {
    console.error(err);
    res.status(200).json({ ok: false, pesan: 'Gagal mengunggah file. Periksa internet lalu coba lagi.' });
  }
};
