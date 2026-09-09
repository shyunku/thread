class UserService {
  constructor() {
    this.userId = null;
  }

  /**
   * @param serviceGroup {ServiceGroup}
   */
  inject(serviceGroup) { this.group=serviceGroup; }

  setCurrent(userId) {
    if(this.userId!==userId)this.group?.vaultWorkspaceService?.reset();
    this.userId = userId;
  }

  getCurrent() {
    return this.userId;
  }
}

module.exports = UserService;
