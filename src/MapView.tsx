import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { City, Order } from "./types";
import { buildMapHtml } from "./mapHtml";

type MapViewProps = {
  city: City;
  orders: Order[];
  activeOrderId?: string;
  onSelectOrder?: (orderId: string) => void;
  pickable?: boolean;
  pickPoint?: [number, number];
  onPick?: (coords: [number, number]) => void;
};

export function MapView({
  city,
  orders,
  activeOrderId,
  onSelectOrder,
  pickable,
  pickPoint,
  onPick
}: MapViewProps) {
  const html = useMemo(
    () => buildMapHtml({ city, orders, activeOrderId, target: "rn", pickable, pickPoint }),
    [activeOrderId, city, orders, pickable, pickPoint]
  );

  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      onMessage={(event) => {
        const data = event.nativeEvent.data;
        if (!data) {
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed && Array.isArray(parsed.pick)) {
            onPick?.(parsed.pick as [number, number]);
            return;
          }
        } catch {
          // не JSON — это id заказа
        }
        onSelectOrder?.(data);
      }}
      style={styles.webview}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "#F7F4EE"
  }
});
