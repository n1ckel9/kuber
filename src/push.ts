import Constants from "expo-constants";
import { Platform } from "react-native";

// Получить Expo push-токен. Только на устройстве (native); на web и при любой
// ошибке возвращает null. expo-notifications импортируется динамически, чтобы
// не влиять на web-сборку. Для боевых пушей нужен dev/prod build (в Expo Go
// поддержка ограничена).
export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return null;
  }
  try {
    const Notifications = await import("expo-notifications");
    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") {
      return null;
    }
    // projectId нужен для получения Expo push-токена в собранном приложении.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return token?.data ?? null;
  } catch {
    return null;
  }
}
