import { createElement, useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
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
    () => buildMapHtml({ city, orders, activeOrderId, target: "web", pickable, pickPoint }),
    [activeOrderId, city, orders, pickable, pickPoint]
  );

  // Сообщения из iframe: либо id заказа (строка), либо {pick:[lng,lat]} (JSON).
  useEffect(() => {
    function handler(event: MessageEvent) {
      const data = event.data;
      if (typeof data !== "string") {
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.pick)) {
          onPick?.(parsed.pick as [number, number]);
          return;
        }
      } catch {
        // не JSON — значит это id заказа
      }
      if (orders.some((order) => order.id === data)) {
        onSelectOrder?.(data);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [orders, onSelectOrder, onPick]);

  // Абсолютное позиционирование iframe — чтобы он занял всю высоту родителя,
  // а не схлопнулся до 0 во flex-контейнере.
  return (
    <View style={styles.wrap}>
      {createElement("iframe", {
        title: "map",
        srcDoc: html,
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          border: "0"
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 320,
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#F7F4EE"
  }
});
