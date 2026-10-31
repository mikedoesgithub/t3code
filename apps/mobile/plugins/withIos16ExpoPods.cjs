const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

// Expo SDK 58 pins its pods to iOS 16.4, which makes `pod install` reject a
// lower Podfile platform. Rewrite those floors to 16.0 so the compiler (not
// the resolver) verifies iOS 16 support. Runs before `pod install`.
const IOS_FLOOR = "16.0";
const PATTERNS = [
  /(:ios\s*=>\s*['"])(\d+)\.(\d+)(['"])/g,
  /(s\.ios\.deployment_target\s*=\s*['"])(\d+)\.(\d+)(['"])/g,
  /(s\.platform\s*=\s*:ios\s*,\s*['"])(\d+)\.(\d+)(['"])/g,
];

function needsFloor(major, minor) {
  return major > 16 || (major === 16 && minor > 0);
}

function rewritePodspec(contents) {
  let touched = false;
  for (const pattern of PATTERNS) {
    contents = contents.replace(pattern, (match, pre, major, minor, post) => {
      if (!needsFloor(Number(major), Number(minor))) return match;
      touched = true;
      return `${pre}${IOS_FLOOR}${post}`;
    });
  }
  return { contents, touched };
}

function walkPodspecs(dir, seen, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(full);
      if (seen.has(real)) continue;
      seen.add(real);
      if (fs.statSync(real).isDirectory()) walkPodspecs(real, seen, out);
      else if (real.endsWith(".podspec")) out.push(real);
    } else if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      walkPodspecs(full, seen, out);
    } else if (entry.name.endsWith(".podspec")) {
      out.push(full);
    }
  }
}

module.exports = function withIos16ExpoPods(config) {
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const mobileRoot = path.dirname(nextConfig.modRequest.platformProjectRoot);
      const repoRoot = path.resolve(mobileRoot, "..", "..");
      const roots = [
        path.join(repoRoot, "node_modules"),
        path.join(mobileRoot, "node_modules"),
      ];
      const seen = new Set();
      const specs = [];
      for (const root of roots) walkPodspecs(root, seen, specs);

      const lowered = [];
      for (const spec of specs) {
        const before = fs.readFileSync(spec, "utf8");
        const { contents, touched } = rewritePodspec(before);
        if (!touched) continue;
        fs.writeFileSync(spec, contents, "utf8");
        lowered.push(path.relative(repoRoot, spec));
      }
      for (const file of lowered) {
        console.log(`T3Code: lowered iOS floor to ${IOS_FLOOR} in ${file}`);
      }
      console.log(`T3Code: withIos16ExpoPods lowered ${lowered.length} podspecs`);
      return nextConfig;
    },
  ]);
};
