import { useState, type JSX } from "react";
import { Image, View } from "react-native";
import { Button, Spinner, Typography, useToast } from "heroui-native";
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";

import { useAuth } from "@/lib/auth-context";

export default function LoginScreen(): JSX.Element {
  const { signIn } = useAuth();
  const { toast } = useToast();
  const [isSigningIn, setIsSigningIn] = useState(false);

  async function handlePress(): Promise<void> {
    setIsSigningIn(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        return;
      }

      const { idToken } = response.data;
      if (!idToken) {
        throw new Error("Google did not return an idToken");
      }

      await signIn(idToken);
    } catch (error) {
      const wasCancelled = isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED;
      if (!wasCancelled) {
        toast.show("Não foi possível entrar, tente de novo.");
      }
    } finally {
      setIsSigningIn(false);
    }
  }

  return (
    <View className="flex-1 bg-background items-center justify-center gap-8 px-6">
      <Image source={require("@/assets/images/icon.png")} className="w-24 h-24" />
      <Typography.Heading type="h3">Gradline</Typography.Heading>
      <Button
        className="w-full"
        isDisabled={isSigningIn}
        isIconOnly={isSigningIn}
        onPress={handlePress}
      >
        {isSigningIn ? <Spinner /> : "Entrar com Google"}
      </Button>
    </View>
  );
}
