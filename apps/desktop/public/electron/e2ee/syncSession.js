// Shared with the mobile app: packages/e2ee/src/syncSession.js
// The desktop adds its legacy migration journal; the mobile app has none.
require("./platform");
const shared=require("@thread/e2ee/src/syncSession");
module.exports={openSyncSession:options=>shared.openSyncSession({...options,
 migrationJournalFor:store=>require("./applicationMigration").stateFor(store)})};
