// Stockage des comptes et des sauvegardes.
//  - Si MONGODB_URI est défini  -> MongoDB Atlas (permanent, gratuit en M0)  ✅ à utiliser sur Render
//  - Sinon                      -> simple fichier JSON local (pour tester sur votre PC).
//                                  ⚠️ Sur Render Free ce fichier est effacé à chaque redémarrage !
//
// Chaque compte : { _id, username, pass, createdAt, save, rev, updatedAt }
//   _id  = pseudo normalisé (minuscules)
//   save = { keys: { "<clé localStorage>": "<valeur>" } } ou null
//   rev  = numéro de version de la sauvegarde (sert à détecter les conflits entre appareils)
const fs = require("fs");

async function createMongoStore(uri) {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || "festival_tcg").collection("users");

  return {
    kind: "mongodb",
    async getUser(id) {
      return col.findOne({ _id: id });
    },
    async createUser(user) {
      try {
        await col.insertOne(user);
        return true;
      } catch (e) {
        if (e && e.code === 11000) return false; // pseudo déjà pris
        throw e;
      }
    },
    // baseRev = numéro attendu (comparaison atomique) ; null = écriture forcée
    async putSave(id, baseRev, save) {
      const filter = baseRev === null ? { _id: id } : { _id: id, rev: baseRev };
      const doc = await col.findOneAndUpdate(
        filter,
        { $set: { save, updatedAt: Date.now() }, $inc: { rev: 1 } },
        { returnDocument: "after" }
      );
      return doc ? { ok: true, rev: doc.rev } : { ok: false };
    },
  };
}

function createFileStore(file) {
  let users = {};
  try {
    users = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    users = {};
  }
  let writing = null;
  const persist = () => {
    clearTimeout(writing);
    writing = setTimeout(() => {
      try { fs.writeFileSync(file, JSON.stringify(users)); } catch (e) { console.error("Écriture impossible :", e.message); }
    }, 200);
  };

  return {
    kind: "file",
    async getUser(id) {
      return users[id] ? JSON.parse(JSON.stringify(users[id])) : null;
    },
    async createUser(user) {
      if (users[user._id]) return false;
      users[user._id] = JSON.parse(JSON.stringify(user));
      persist();
      return true;
    },
    async putSave(id, baseRev, save) {
      const u = users[id];
      if (!u) return { ok: false };
      if (baseRev !== null && u.rev !== baseRev) return { ok: false };
      u.save = save;
      u.rev = (u.rev || 0) + 1;
      u.updatedAt = Date.now();
      persist();
      return { ok: true, rev: u.rev };
    },
  };
}

async function createStore() {
  if (process.env.MONGODB_URI) {
    const store = await createMongoStore(process.env.MONGODB_URI);
    console.log("Stockage : MongoDB Atlas");
    return store;
  }
  const file = process.env.DATA_FILE || "./data.json";
  console.warn("⚠️  MONGODB_URI absent : stockage dans " + file + " (NON permanent sur Render Free).");
  return createFileStore(file);
}

module.exports = { createStore };