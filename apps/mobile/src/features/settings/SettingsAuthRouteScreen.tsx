import { useAuth, useClerk, useSignIn, useSignUp, useUser } from "@clerk/expo";
import {
  AuthView,
  type UserProfileCustomPage,
  UserProfileView,
} from "@clerk/expo/native-components";
import { useNavigation } from "@react-navigation/native";
import { requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { AppTextInput } from "../../components/ui/AppText";
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
  // Browser hosted auth needs the app's custom-scheme redirect allowlisted on
  // the Clerk instance (dashboard), which this build can't rely on, so sign in
  // with an email code instead. Pure JS, no redirect URI involved.
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [pending, setPending] = useState(false);

  const sendCode = async () => {
    if (pending || !signIn || !signUp) return;
    const identifier = email.trim();
    if (!identifier) {
      Dialog.alert("Enter your email", "Type the email address for your T3 account first.");
      return;
    }
    setPending(true);
    try {
      const { error: createError } = await signIn.create({ identifier });
      if (createError) {
        if (isIdentifierNotFoundError(createError)) {
          const { error: signUpError } = await signUp.create({ emailAddress: identifier });
          if (signUpError) {
            Dialog.alert("Couldn't send a code", clerkErrorMessage(signUpError));
            return;
          }
          const { error: verifyError } = await signUp.verifications.sendEmailCode();
          if (verifyError) {
            Dialog.alert("Couldn't send a code", clerkErrorMessage(verifyError));
            return;
          }
          setIsNewAccount(true);
          setStep("code");
        } else {
          Dialog.alert("Couldn't send a code", clerkErrorMessage(createError));
        }
        return;
      }
      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) Dialog.alert("Couldn't sign in", clerkErrorMessage(finalizeError));
        return;
      }
      const { error: sendError } = await signIn.emailCode.sendCode();
      if (sendError) {
        Dialog.alert("Couldn't send a code", clerkErrorMessage(sendError));
        return;
      }
      setIsNewAccount(false);
      setStep("code");
    } catch (error) {
      Dialog.alert("Couldn't send a code", clerkErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const verifyCode = async () => {
    if (pending || !signIn || !signUp) return;
    const cleanCode = code.trim();
    if (!cleanCode) {
      Dialog.alert("Enter the code", "Type the code we emailed you, then verify.");
      return;
    }
    setPending(true);
    try {
      if (isNewAccount) {
        const { error } = await signUp.verifications.verifyEmailCode({ code: cleanCode });
        if (error) {
          Dialog.alert("Couldn't sign in", clerkErrorMessage(error));
          return;
        }
        if (signUp.status === "complete") {
          const { error: finalizeError } = await signUp.finalize();
          if (finalizeError) Dialog.alert("Couldn't sign in", clerkErrorMessage(finalizeError));
        } else {
          Dialog.alert("Couldn't sign in", "That code didn't finish creating the account. Try again.");
        }
      } else {
        const { error } = await signIn.emailCode.verifyCode({ code: cleanCode });
        if (error) {
          Dialog.alert("Couldn't sign in", clerkErrorMessage(error));
          return;
        }
        if (signIn.status === "complete") {
          const { error: finalizeError } = await signIn.finalize();
          if (finalizeError) Dialog.alert("Couldn't sign in", clerkErrorMessage(finalizeError));
        } else {
          Dialog.alert("Couldn't sign in", "That code wasn't accepted. Try again.");
        }
      }
    } catch (error) {
      Dialog.alert("Couldn't sign in", clerkErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const resendCode = async () => {
    if (pending || !signIn || !signUp) return;
    setPending(true);
    try {
      const { error } = isNewAccount
        ? await signUp.verifications.sendEmailCode()
        : await signIn.emailCode.sendCode();
      if (error) Dialog.alert("Couldn't resend", clerkErrorMessage(error));
    } catch (error) {
      Dialog.alert("Couldn't resend", clerkErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const useDifferentEmail = () => {
    setStep("email");
    setCode("");
  };

  if (step === "code") {
    return (
      <View className="flex-1">
        <FallbackHeader title="T3 Connect" onBack={props.onBack} />
        <View className="flex-1 items-center justify-center gap-3 px-8 pb-16">
          <Text className="text-center text-lg text-foreground">Check your email</Text>
          <Text className="text-center text-sm text-foreground-muted">
            We sent a code to {email.trim()}.
          </Text>
          <AppTextInput
            accessibilityLabel="One-time code"
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            editable={!pending}
            onSubmitEditing={() => void verifyCode()}
            className="w-full"
          />
          <Button
            label={pending ? "Verifying…" : "Verify code"}
            loading={pending}
            onPress={() => void verifyCode()}
          />
          <Button
            label="Resend code"
            tone="secondary"
            onPress={() => void resendCode()}
          />
          <Button label="Use a different email" tone="text" onPress={useDifferentEmail} />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <FallbackHeader title="T3 Connect" onBack={props.onBack} />
      <View className="flex-1 items-center justify-center gap-3 px-8 pb-16">
        <Text className="text-center text-lg text-foreground">Sign in to T3 Connect</Text>
        <Text className="text-center text-sm text-foreground-muted">
          This build signs in with an email code, then returns here.
        </Text>
        <AppTextInput
          accessibilityLabel="Email address"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          editable={!pending}
          onSubmitEditing={() => void sendCode()}
          className="w-full"
        />
        <Button
          label={pending ? "Sending code…" : "Send code"}
          loading={pending}
          onPress={() => void sendCode()}
        />
      </View>
    </View>
  );
}

function isIdentifierNotFoundError(error: unknown): boolean {
  return getErrorCode(error) === "form_identifier_not_found";
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as {
    errors?: readonly { code?: string }[];
    code?: string;
  };
  return record.errors?.[0]?.code ?? (typeof record.code === "string" ? record.code : null);
}

function clerkErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as {
      errors?: readonly { longMessage?: string; message?: string }[];
      longMessage?: string;
      message?: string;
    };
    const first = record.errors?.[0]?.longMessage ?? record.errors?.[0]?.message;
    if (first) return first;
    const direct =
      typeof record.longMessage === "string"
        ? record.longMessage
        : typeof record.message === "string"
          ? record.message
          : null;
    if (direct) return direct;
  }
  return error instanceof Error ? error.message : "The sign-in failed. Try again.";
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
