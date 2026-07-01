import AsyncStorage from "@react-native-async-storage/async-storage";

// Тонкая обёртка над AsyncStorage (на web использует localStorage).
const TOKEN_KEY = "vodovoz.token";

export async function loadToken() {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string) {
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // игнорируем — в худшем случае пользователь перелогинится
  }
}

export async function clearToken() {
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // no-op
  }
}
