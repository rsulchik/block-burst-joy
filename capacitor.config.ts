import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.blockblast.joy",
  appName: "Block Blast",
  webDir: "dist/client",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    StatusBar: {
      style: "DARK",
      backgroundColor: "#1a2030",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_block_blast",
      iconColor: "#3b82f6",
    },
  },
};

export default config;
