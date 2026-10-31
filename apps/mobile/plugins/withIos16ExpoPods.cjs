const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

// Expo SDK 58 pins its pods to iOS 16.4 and expo-build-properties rejects a
// lower deploymentTarget, so this plugin owns the 16.0 floor: it lowers
// third-party podspec floors before `pod install` resolution, pins the Podfile
// platform, and pins the Xcode targets. The compiler (not the resolver) then
// verifies iOS 16 support. Runs before `pod install`.
const IOS_FLOOR = "16.0";
const PATTERNS = [
  /(:ios\s*=>\s*['"])(\d+)\.(\d+)(['"])/g,
  /(s\.ios\.deployment_target\s*=\s*['"])(\d+)\.(\d+)(['"])/g,
  /(s\.platform\s*=\s*:ios\s*,\s*['"])(\d+)\.(\d+)(['"])/g,
  /(IPHONEOS_DEPLOYMENT_TARGET\s*=\s*['"]?)(\d+)\.(\d+)/g,
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
      let real;
      try {
        real = fs.realpathSync(full);
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      try {
        if (fs.statSync(real).isDirectory()) walkPodspecs(real, seen, out);
        else if (real.endsWith(".podspec")) out.push(real);
      } catch {
        continue;
      }
    } else if (entry.isDirectory()) {
      // Descend into .pnpm: transitive deps live in sibling store dirs that
      // direct symlinks alone never reach.
      if (entry.name.startsWith(".") && entry.name !== ".pnpm") continue;
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
      const projectRoot = nextConfig.modRequest.platformProjectRoot;
      dropClerkNativePodspec(nextConfig.modRequest.projectRoot);
      lowerPodspecFloors(nextConfig.modRequest.projectRoot);
      pinPodfilePlatform(projectRoot);
      pinXcodeDeploymentTargets(projectRoot);
      return nextConfig;
    },
  ]);
};

function dropClerkNativePodspec(mobileRoot) {
  // clerk-ios ships through SPM, declares iOS 17, and links Observation: any
  // binary containing it dies at launch on iOS 16 (dyld has no Observation to
  // load). With no podspec, iOS autolinking skips the package entirely, so no
  // ClerkExpo pod, no ClerkKit, and no provider references are generated. The
  // Settings auth screen detects the missing native module and signs in
  // through the browser instead.
  const candidates = [];
  try {
    candidates.push(
      path.dirname(
        require.resolve("@clerk/expo-native-components/package.json", {
          paths: [mobileRoot],
        }),
      ),
    );
  } catch {
    // Fall through to the manual search below.
  }
  candidates.push(
    path.join(mobileRoot, "node_modules", "@clerk", "expo-native-components"),
  );
  for (const dir of candidates) {
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      continue;
    }
    const podspec = path.join(real, "ios", "ClerkExpo.podspec");
    if (!fs.existsSync(podspec)) continue;
    fs.rmSync(podspec);
    console.log(
      `T3Code: dropped ClerkExpo.podspec for the iOS 16 build (${path.relative(mobileRoot, podspec)})`,
    );
    return;
  }
}

function lowerPodspecFloors(mobileRoot) {
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
  assertNoHigherFloors(specs, repoRoot);
}

function assertNoHigherFloors(specs, repoRoot) {
  const offenders = [];
  for (const spec of specs) {
    const contents = fs.readFileSync(spec, "utf8");
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(contents)) !== null) {
        if (needsFloor(Number(match[2]), Number(match[3]))) {
          offenders.push(`${path.relative(repoRoot, spec)}: ${match[1]}${match[2]}.${match[3]}${match[4] ?? ""}`);
        }
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `withIos16ExpoPods: ${offenders.length} podspecs still require iOS above ${IOS_FLOOR}:\n${offenders.join("\n")}`,
    );
  }
}

function pinPodfilePlatform(projectRoot) {
  const podfilePath = path.join(projectRoot, "Podfile");
  const podfile = fs.readFileSync(podfilePath, "utf8");
  const line = `platform :ios, '${IOS_FLOOR}'`;
  const next = /^platform :ios.*$/m.test(podfile)
    ? podfile.replace(/^platform :ios.*$/m, line)
    : `${line}\n${podfile}`;
  if (next !== podfile) {
    fs.writeFileSync(podfilePath, next, "utf8");
    console.log(`T3Code: pinned Podfile platform to iOS ${IOS_FLOOR}`);
  }
}

function pinXcodeDeploymentTargets(projectRoot) {
  const targets = fs
    .readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"))
    .map((entry) => path.join(projectRoot, entry.name, "project.pbxproj"))
    .filter((file) => fs.existsSync(file));
  const pattern = /IPHONEOS_DEPLOYMENT_TARGET = "?[^";]*"?;/g;
  const replacement = `IPHONEOS_DEPLOYMENT_TARGET = ${IOS_FLOOR};`;
  for (const file of targets) {
    const before = fs.readFileSync(file, "utf8");
    const matches = before.match(pattern) || [];
    if (matches.length === 0) {
      throw new Error(`Unable to pin iOS floor: no IPHONEOS_DEPLOYMENT_TARGET in ${file}.`);
    }
    fs.writeFileSync(file, before.replace(pattern, replacement), "utf8");
    console.log(`T3Code: pinned ${matches.length} targets to iOS ${IOS_FLOOR} in ${path.basename(path.dirname(file))}`);
  }
}
