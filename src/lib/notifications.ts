import { PushNotifications, Token } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabase } from "./supabase";

// FCM requires android/app/google-services.json. Keep it opt-in so an APK
// without that file never calls Firebase during startup and cannot crash.
const pushNotificationsEnabled = import.meta.env["VITE_ENABLE_PUSH_NOTIFICATIONS"] === "true";
let pushNotificationsInitialized = false;
let dailyReminderScheduled = false;

export type DailyTask = {
  id: string;
  title: string;
  description: string;
  target_score: number;
  reward_points: number;
  created_at: string;
};

/**
 * Инициализация push-уведомлений
 */
export async function initPushNotifications(): Promise<void> {
  if (!pushNotificationsEnabled || pushNotificationsInitialized) return;
  pushNotificationsInitialized = true;

  try {
    // Запрашиваем разрешение
    const result = await PushNotifications.requestPermissions();
    if (result.receive === "granted") {
      // Регистрируем устройство
      await PushNotifications.register();

      // Получаем токен
      PushNotifications.addListener("registration", async (token: Token) => {
        console.log("Push registration success, token: " + token.value);
        await savePushToken(token.value);
      });

      // Обработка ошибок регистрации
      PushNotifications.addListener("registrationError", (error: unknown) => {
        console.error("Error on registration: " + JSON.stringify(error));
      });

      // Обработка входящих уведомлений
      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        console.log("Push notification received: " + JSON.stringify(notification));
      });

      // Обработка нажатия на уведомление
      PushNotifications.addListener("pushNotificationActionPerformed", (notification) => {
        console.log("Push notification action performed: " + JSON.stringify(notification));
      });
    }
  } catch (error) {
    console.error("Error initializing push notifications:", error);
  }
}

/**
 * Сохранение push токена в Supabase
 */
async function savePushToken(token: string): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("user_devices").upsert({
      user_id: user.id,
      push_token: token,
      platform: "android",
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error saving push token:", error);
  }
}

/**
 * Настройка локальных уведомлений для ежедневных заданий
 */
export async function scheduleDailyReminder(): Promise<void> {
  if (dailyReminderScheduled) return;
  dailyReminderScheduled = true;

  try {
    // Проверяем разрешение
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      const result = await LocalNotifications.requestPermissions();
      if (result.display !== "granted") {
        console.log("Local notifications permission not granted");
        return;
      }
    }

    // Отменяем существующие уведомления
    await LocalNotifications.cancelAll();

    // Создаем ежедневное уведомление на 19:00
    const now = new Date();
    const notificationTime = new Date();
    notificationTime.setHours(19, 0, 0, 0); // 19:00

    if (notificationTime <= now) {
      notificationTime.setDate(notificationTime.getDate() + 1);
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          id: 1,
          title: "Block Blast - Ежедневное задание!",
          body: "Не забудьте выполнить сегодняшнее задание и получить бонусные очки!",
          schedule: {
            at: notificationTime,
            allowWhileIdle: true,
            repeats: true,
          },
          sound: "default",
          smallIcon: "ic_stat_block_blast",
          iconColor: "#3b82f6",
        },
      ],
    });

    console.log("Daily reminder scheduled for:", notificationTime);
  } catch (error) {
    dailyReminderScheduled = false;
    console.error("Error scheduling daily reminder:", error);
  }
}

/**
 * Отправка локального уведомления о достижении
 */
export async function sendAchievementNotification(title: string, body: string): Promise<void> {
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now(),
          title,
          body,
          sound: "default",
          smallIcon: "ic_stat_block_blast",
          iconColor: "#10b981",
        },
      ],
    });
  } catch (error) {
    console.error("Error sending achievement notification:", error);
  }
}

/**
 * Создание ежедневного задания в Supabase
 */
export async function getTodayTask(): Promise<DailyTask | null> {
  try {
    const { data, error } = await supabase.rpc("get_daily_task");

    if (error) throw error;
    return Array.isArray(data) ? (data[0] ?? null) : data;
  } catch (error) {
    console.error("Error getting today task:", error);
    return null;
  }
}

export async function hasCompletedDailyTask(taskId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("task_completions")
      .select("id")
      .eq("task_id", taskId)
      .maybeSingle();

    if (error) throw error;
    return data !== null;
  } catch (error) {
    console.error("Error checking daily task status:", error);
    return false;
  }
}

export async function getWalletBalance(userId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("wallet_points")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return typeof data.wallet_points === "number" ? data.wallet_points : 0;
  } catch (error) {
    console.error("Error loading wallet balance:", error);
    return null;
  }
}
