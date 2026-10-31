const { withEntitlementsPlist } = require("expo/config-plugins");

// Unsigned TrollStore builds have no Apple team prefix, so an explicit
// keychain-access-groups entitlement can only break keychain access. Drop it
// so the OS default sandbox group is used. No-op unless T3CODE_TROLLSTORE=1.
module.exports = function withTrollStoreEntitlements(config) {
  if (process.env.T3CODE_TROLLSTORE !== "1") return config;
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["keychain-access-groups"];
    return modConfig;
  });
};
