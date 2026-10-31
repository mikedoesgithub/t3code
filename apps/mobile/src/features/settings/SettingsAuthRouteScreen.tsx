import { useAuth, useClerk, useUser } from "@clerk/expo";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import {
  AuthView,
  type UserProfileCustomPage,
  UserProfileView,
} from "@clerk/expo/native-components";
import { useNavigation } from "@react-navigation/native";
import { requireOptionalNativeModule } from "expo";
import { makeRedirectUri } from "expo-auth-session";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "../../components/ui/Button";
import { ControlPill } from "../../components/ui/ControlPill";
import * as Dialog from "../../components/ui/Dialog";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { T3ConnectProfilePage } from "../cloud/T3ConnectProfilePage";

const USER_PROFILE_CUSTOM_PAGES = [
  {
    path: "t3-connect",
    label: "T3 Connect",
    icon: "globe",
    content: <T3ConnectProfilePage />,
  },
] satisfies UserProfileCustomPage[];

// The iOS 16 build drops the ClerkExpo pod (clerk-ios needs iOS 17 and would
// crash at launch), so the native views below are absent and auth falls back
// to the browser. Regular builds keep the native UI.
const hasClerkNativeModule = requireOptionalNativeModule("ClerkExpo") != null;

// Without cloud config the app has no entry point here and appLinking drops the deep link.
export function SettingsAuthRouteScreen() {
  return hasCloudPublicConfig() ? <ConfiguredSettingsAuthRouteScreen /> : null;
}

function ConfiguredSettingsAuthRouteScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const handleHostBack = () => navigation.goBack();
  // Once signed in, stay on the profile view so signing out pops back instead of
  // flashing the sign-in form.
  const [hasBeenSignedIn, setHasBeenSignedIn] = useState(isSignedIn === true);
  if (isSignedIn && !hasBeenSignedIn) setHasBeenSignedIn(true);

  // Clerk reports sign-out only through its auth store (the native profile view
  // and the T3 Connect page can both sign out), so this follows that store.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pops the navigator when Clerk's auth store reports a sign-out from the profile view or Connect page
  useEffect(() => {
    if (hasBeenSignedIn && isLoaded && isSignedIn === false) {
      navigation.goBack();
    }
  }, [hasBeenSignedIn, isLoaded, isSignedIn, navigation]);

  return (
    <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
      {isLoaded ? (
        hasBeenSignedIn ? (
          hasClerkNativeModule ? (
            <UserProfileView
              customPages={USER_PROFILE_CUSTOM_PAGES}
              isDismissible={false}
              onHostBack={handleHostBack}
            />
          ) : (
            <FallbackProfileView onBack={handleHostBack} />
          )
        ) : hasClerkNativeModule ? (
          <AuthView isDismissible={false} onHostBack={handleHostBack} />
        ) : (
          <FallbackSignInView onBack={handleHostBack} />
        )
      ) : null}
    </View>
  );
}

function FallbackHeader(props: { readonly title: string; readonly onBack: () => void }) {
  return (
    <View className="flex-row items-center gap-1 px-2 pt-2">
      <ControlPill icon="chevron.left" accessibilityLabel="Back" onPress={props.onBack} />
      <Text className="text-lg text-foreground">{props.title}</Text>
    </View>
  );
}

function FallbackSignInView(props: { readonly onBack: () => void }) {
  const { startHostedAuth } = useHostedAuth();
  const [pending, setPending] = useState(false);
  // The app scheme is registered for callbacks; the bundle-id default is not.
  const redirectUrl = useMemo(() => makeRedirectUri({ path: "hosted-auth-callback" }), []);
  const signIn = async () => {
    if (pending) return;
    setPending(true);
    try {
      const { createdSessionId } = await startHostedAuth({ redirectUrl });
      if (!createdSessionId) {
        Dialog.alert(
          "Sign-in didn't finish",
          "The browser closed before sign-in completed. Try again.",
        );
      }
    } catch (error) {
      Dialog.alert(
        "Couldn't sign in",
        error instanceof Error ? error.message : "The browser sign-in failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <View className="flex-1">
      <FallbackHeader title="T3 Connect" onBack={props.onBack} />
      <View className="flex-1 items-center justify-center gap-3 px-8 pb-16">
        <Text className="text-center text-lg text-foreground">Sign in to T3 Connect</Text>
        <Text className="text-center text-sm text-foreground-muted">
          This build signs in through the browser, then returns here.
        </Text>
        <Button
          label={pending ? "Waiting for the browser…" : "Sign in"}
          loading={pending}
          onPress={() => void signIn()}
        />
      </View>
    </View>
  );
}

function FallbackProfileView(props: { readonly onBack: () => void }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? null;
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      Dialog.alert(
        "Couldn't sign out",
        error instanceof Error ? error.message : "Sign-out failed. Try again.",
      );
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <View collapsable={false} className="flex-1">
      <FallbackHeader title="Account" onBack={props.onBack} />
      <View className="gap-2 border-b border-border-subtle px-6 py-4">
        <Text className="text-sm text-foreground-muted">
          {email ? `Signed in as ${email}` : "Signed in"}
        </Text>
        <Button
          label={signingOut ? "Signing out…" : "Sign out"}
          tone="secondary"
          loading={signingOut}
          onPress={() => void handleSignOut()}
        />
      </View>
      <View className="flex-1">
        <T3ConnectProfilePage />
      </View>
    </View>
  );
}
