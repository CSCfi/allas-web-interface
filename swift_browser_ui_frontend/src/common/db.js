import Dexie from "dexie";
import { DEV } from "@/common/conv";

function initDB() {
  const db = new Dexie("sd-connect", { cache: "disabled" });
  db.version(1).stores({
    projects: "&id, name",
    containers: "++id, &[projectID+name], *tags, *tokens",
    objects: "++id, &[containerID+name], *tags, *tokens",
    preferences: "id",
  });
  db.objects.hook("creating", function (_key, obj) {
    obj.bytes = Number(obj.bytes ?? 0);
  });

  db.objects.hook("updating", function (mods, _key, oldObj) {
    if ("bytes" in mods) {
      const incoming = Number(mods.bytes ?? 0);
      const isFolder = oldObj.name?.endsWith("/");
      // Keep an already-known non-zero size if an update tries to set 0
      if (!isFolder && incoming === 0 && Number(oldObj.bytes ?? 0) > 0) {
        delete mods.bytes; // do not overwrite with 0
      }
    }
    return mods;
  });
  db.preferences.count((count) => {
    if (count === 0) {
      db.preferences.add({ id: 1 });
    }
  });

  return db;
}

// From https://github.com/dexie/Dexie.js/issues/613#issuecomment-841608979
let DB;

export function getDB() {
  if (!DB) {
    DB = initDB();
  }

  const idb = DB.backendDB();

  if (idb) {
    try {
      // Check if if connection to idb did not close in the meantime
      idb.transaction("preferences").abort();
      return DB;
    } catch (e) {
      if (DEV) console.log("DB error", e);
    }
    DB.close();
    DB = initDB();
  }

  return DB;
}
