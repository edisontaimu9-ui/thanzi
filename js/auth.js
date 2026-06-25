const ThanziAuth = (() => {
  const client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const account = new Appwrite.Account(client);

  const register = async (name, email, password) => {
    try {
      await account.create(Appwrite.ID.unique(), email, password, name);
      await account.createEmailSession(email, password);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const login = async (email, password) => {
    try {
      await account.createEmailSession(email, password);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      await account.deleteSession('current');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const getUser = async () => {
    try {
      return await account.get();
    } catch {
      return null;
    }
  };

  const updateName = async (name) => {
    try {
      const user = await account.updateName(name);
      return { success: true, user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  return { register, login, logout, getUser, updateName };
})();
