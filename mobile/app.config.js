const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = {
  expo: {
    name: IS_DEV ? "UFBA (Dev)" : "UFBA",
    slug: "ufba",
    version: "1.0.3",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "ufba-app",
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: IS_DEV
        ? "com.espectrotech.ufba.dev"
        : "com.espectrotech.ufba",
    },
    android: {
      package: IS_DEV ? "com.espectrotech.ufba.dev" : "com.espectrotech.ufba",
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#FFFFFF",
      },
      backgroundColor: "#FFFFFF",
      predictiveBackGestureEnabled: false,
      versionCode: 4,
      permissions: ["REQUEST_INSTALL_PACKAGES"],
    },
    plugins: [
      "expo-router",
      "expo-font",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          resizeMode: "contain",
          backgroundColor: "#FFFFFF",
        },
      ],
      "@react-native-google-signin/google-signin",
      "expo-secure-store",
      [
        "expo-calendar",
        {
          calendarPermission:
            "O app usa o calendário para exportar o horário de aulas do semestre.",
          remindersPermission: false,
        },
      ],
      [
        "expo-system-ui",
        {
          userInterfaceStyle: "automatic",
        },
      ],
      "expo-sharing",
      "expo-status-bar",
      "expo-web-browser",
      // Fora da Play Store não há App Bundle com split por ABI — um APK
      // "universal" carregaria arm64-v8a, armeabi-v7a, x86 e x86_64 juntos
      // (~80MB só de libs nativas). x86/x86_64 só servem emulador, e
      // armeabi-v7a (32-bit) é uma fração residual de aparelhos hoje. Restrito
      // a arm64-v8a — a esmagadora maioria dos celulares reais — exceto no
      // client de dev, que ainda pode precisar rodar em emulador x86_64.
      ...(IS_DEV
        ? []
        : [["expo-build-properties", { android: { buildArchs: ["arm64-v8a"] } }]]),
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      eas: {
        projectId: "e902672b-16bf-4f5a-abbf-4f42f2299283",
      },
    },
  },
};
