class TxContent {
  constructor() {}

  instanceOf(object) {
    // check object
    if (object == null) throw new Error("Object is null");
    if (typeof object !== "object") {
      throw new Error("INVALID_TRANSACTION_CONTENT");
    }

    // check properties
    // iterate properties
    for (let key in object) {
      if (!this.hasOwnProperty(key)) {
        console.error("UNKNOWN_TRANSACTION_PROPERTY");
        return false;
      }
    }
    return true;
  }
}

module.exports = TxContent;
