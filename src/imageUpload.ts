import * as ImagePicker from "expo-image-picker";

// Максимальный размер итоговой data-URL строки (сервер принимает до ~6 МБ).
const MAX_DATA_URL = 5 * 1024 * 1024;

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
      return { ok: false, error: "Фото слишком большое. Выберите снимок поменьше." };
    }

    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, error: "Ошибка выбора фото" };
  }
}
