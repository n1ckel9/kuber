import * as ImagePicker from "expo-image-picker";

// Лимит ~2 МБ картинки (base64 раздувает на ~33% → ~2.8 МБ строки). Синхронно с сервером.
const MAX_DATA_URL = Math.round(2.8 * 1024 * 1024);

export type PickImageResult = { ok: true; dataUrl: string } | { ok: false; error: string };

// Выбрать фото из галереи и вернуть его как base64 data-URL (для отправки в JSON).
// Сжатие через quality; ресайза нет (без expo-image-manipulator, чтобы не ломать web).
export async function pickImageAsBase64(): Promise<PickImageResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return { ok: false, error: "Нет доступа к галерее. Разрешите доступ в настройках." };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.5,
      base64: true
    });

    if (result.canceled) {
      return { ok: false, error: "" }; // отмена — без ошибки
    }

    const asset = result.assets?.[0];
    if (!asset) {
      return { ok: false, error: "Не удалось получить фото" };
    }

    let dataUrl = "";
    if (asset.base64) {
      const mime = asset.mimeType || "image/jpeg";
      dataUrl = `data:${mime};base64,${asset.base64}`;
    } else if (asset.uri && asset.uri.startsWith("data:")) {
      // web: uri уже может быть data-URL
      dataUrl = asset.uri;
    } else {
      return { ok: false, error: "Формат фото не поддерживается" };
    }

    if (dataUrl.length > MAX_DATA_URL) {
      return { ok: false, error: "Фото больше 2 МБ. Выберите снимок поменьше или обрежьте." };
    }

    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, error: "Ошибка выбора фото" };
  }
}
