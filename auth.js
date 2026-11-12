// Authentification : hachage des mots de passe (scrypt) et jetons signés (HMAC-SHA256).
// Aucune dépendance externe : tout vient du module "crypto" de Node.
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const TOKEN_TTL_MS = 60 * 24 * 3600 * 1000; // 60 jours

// IMPORTANT : définissez AUTH_SECRET dans les variables d'environnement de Render.
// Sans cela, un secret aléatoire est créé à chaque démarrage et tout le monde est déconnecté.
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");
const SECRET_IS_RANDOM = !process.env.AUTH_SECRET;

const b64 = (buf) => Buffer.from(buf).toString("base64url");

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return salt.toString("hex") + ":" + key.toString("hex");
}

async function verifyPassword(password, stored) {
  try {
    const [saltHex, keyHex] = String(stored).split(":");
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const key = await scrypt(password, salt, expected.length);
    return crypto.timingSafeEqual(key, expected);
  } catch (e) {
    return false;
  }
}

// Mot de passe factice pour garder le même temps de réponse si le pseudo n'existe pas
let dummyHash = null;
async function fakeVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword("dummy-password");
  await verifyPassword(password, dummyHash);
}

function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}

function signToken(id, username) {
  const body = b64(JSON.stringify({ id, name: username, exp: Date.now() + TOKEN_TTL_MS }));
  return body + "." + sign(body);
}

// Retourne { id, name } si le jeton est valide, sinon null
function verifyToken(token) {
  try {
    if (typeof token !== "string") return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data || typeof data.id !== "string" || !(data.exp > Date.now())) return null;
    return { id: data.id, name: String(data.name || "Joueur") };
  } catch (e) {
    return null;
  }
}

// Pseudo : 3 à 20 caractères (lettres, chiffres, espace, _ et -)
const USERNAME_RE = /^[\p{L}\p{N}_\- ]{3,20}$/u;
function validUsername(name) {
  return typeof name === "string" && USERNAME_RE.test(name.trim());
}
function accountId(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase().normalize("NFC");
}
function validPassword(pw) {
  return typeof pw === "string" && pw.length >= 6 && pw.length <= 100;
}

module.exports = {
  hashPassword, verifyPassword, fakeVerify, signToken, verifyToken,
  validUsername, accountId, validPassword, SECRET_IS_RANDOM,
};