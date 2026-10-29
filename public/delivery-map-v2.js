// Consolidated, corrected delivery-map script
(function ($) {
   let map = null;
   let placemark = null;
   let selectedZone = null;
   let shippingListenersInited = false;

   function hexToRgba(hex, opacity) {
      if (!hex) return null;
      const h = hex.replace("#", "");
      let r, g, b;
      if (h.length === 3) {
         r = parseInt(h[0] + h[0], 16);
         g = parseInt(h[1] + h[1], 16);
         b = parseInt(h[2] + h[2], 16);
      } else if (h.length === 6) {
         r = parseInt(h.substring(0, 2), 16);
         g = parseInt(h.substring(2, 4), 16);
         b = parseInt(h.substring(4, 6), 16);
      } else {
         return hex;
      }
      if (typeof opacity === "number") return `rgba(${r},${g},${b},${opacity})`;
      return `rgb(${r},${g},${b})`;
   }

   function normalizeFillColor(zone) {
      if (!zone) return null;
      const col = zone.color || zone.fillColor || null;
      const op =
         typeof zone.fillOpacity !== "undefined" && zone.fillOpacity !== null
            ? parseFloat(zone.fillOpacity)
            : null;
      if (!col) return null;
      if (/^rgba?\(/i.test(col)) return col;
      if (/^#/i.test(col)) {
         if (op !== null && !isNaN(op)) return hexToRgba(col, op);
         return col;
      }
      return col;
   }

   function showMapMessage(text, type) {
      $("#wyd_address_message").remove();
      const bg = type === "error" ? "#ffe6e6" : "#eef7ff";
      const color = type === "error" ? "#a00" : "#036";
      const html = `\n      <div id="wyd_address_message" style="margin:6px 0;padding:6px 10px;background:${bg};border-radius:4px;color:${color};font-size:13px;">${text}</div>`;
      let $target = $('input[name^="shipping_method"]:checked').closest("li");
      if (!$target.length) {
         const $courier = $('input[name^="shipping_method"]')
            .filter(function () {
               return String(this.value).indexOf("yd_delivery_v2") === 0;
            })
            .first();
         if ($courier.length) $target = $courier.closest("li");
      }
      if ($target.length) $target.append(html);
      else $("#delivery-map").after(html);
   }

   function displaySelectedSummary(address, zone) {
      $("#wyd_zone_summary").remove();
      const $courier = $('input[name^="shipping_method"]')
         .filter(function () {
            return String(this.value).indexOf("yd_delivery_v2") === 0;
         })
         .first();
      if (!$courier.length) return;
      const $li = $courier.closest("li");
      const priceText =
         zone && typeof zone.price !== "undefined" ? `${zone.price} ₽` : "";
      const addrText = address
         ? `<div style="font-size:13px;color:#333;margin-top:6px;">Адрес: ${address}</div>`
         : "";
      const html = `<div id="wyd_zone_summary" style="margin-top:6px;padding:6px 10px;background:#f6fffa;border:1px solid #dff3e6;border-radius:4px;font-size:13px;color:#073;"><div style="font-weight:600;">Доставка: ${priceText}</div>${addrText}</div>`;
      if ($li.length) $li.append(html);
      else $courier.after(html);
   }

   function loadZones() {
      return $.post(WYD_SETTINGS.ajax_url, {
         action: "wyd_v2_get_zones",
         nonce: WYD_SETTINGS.nonce,
      });
   }
   function probeZoneByCoords(coords) {
      return $.post(WYD_SETTINGS.ajax_url, {
         action: "wyd_check_zone_by_coords",
         lat: coords[0],
         lng: coords[1],
      });
   }
   function setZoneOnServer(zone) {
      return $.post(WYD_SETTINGS.ajax_url, {
         action: "wyd_set_zone",
         nonce: WYD_SETTINGS.nonce,
         zone_id: zone.id || 0,
         zone_price: zone.price || 0,
      });
   }

   function renderZones(respZones) {
      if (!map) return;
      try {
         map.geoObjects.removeAll();
      } catch (e) {}
      const zones = Array.isArray(respZones) ? respZones : [];
      zones.forEach(function (z) {
         if (z.type !== "polygon" || !z.coordinates) return;
         const coords = z.coordinates[0].map(function (p) {
            return [p[1], p[0]];
         });
         const fill = normalizeFillColor(z) || "rgba(0,200,0,0.18)";
         const stroke = z.strokeColor || z.stroke || "#000";
         const strokeW = z.strokeWidth ? parseFloat(z.strokeWidth) : 2;
         const polygon = new ymaps.Polygon(
            [coords],
            {
               hintContent: `${z.name} (${z.price}₽)`,
               balloonContent: `<b>${z.name}</b><br>Доставка: ${z.price}₽`,
            },
            { fillColor: fill, strokeColor: stroke, strokeWidth: strokeW }
         );
         polygon.events.add("click", function () {
            showMapMessage(`${z.name} (${z.price}₽)`, "info");
         });
         map.geoObjects.add(polygon);
      });
   }

   function handleAddressByCoords(coords) {
      if (typeof ymaps === "undefined") return;
      ymaps.geocode(coords).then(function (res) {
         const first = res.geoObjects.get(0);
         const address = first ? first.getAddressLine() : "";
         $("#billing_address_1").val(address);
         if (!isValidAddress(address)) {
            showMapMessage("Введите адрес с улицей и номером дома", "error");
            setZoneOnServer({ id: -1, price: 0, name: "Вне зоны" });
            return;
         }
         checkZoneAndApply(coords, address);
      });
   }

   function checkZoneAndApply(coords, address) {
      probeZoneByCoords(coords)
         .done(function (resp) {
            if (resp && resp.success && resp.data && resp.data.zone) {
               const zone = resp.data.zone;
               const $courier = $('input[name^="shipping_method"]')
                  .filter(function () {
                     return String(this.value).indexOf("yd_delivery_v2") === 0;
                  })
                  .first();
               if ($courier.length)
                  $courier.prop("checked", true).trigger("change");
               setZoneOnServer(zone)
                  .done(function () {
                     selectedZone = zone;
                     showMapMessage(
                        `Вы выбрали: ${zone.name} — ${zone.price} ₽`,
                        "info"
                     );
                     displaySelectedSummary(address || null, zone);
                     setTimeout(function () {
                        if ($("body").hasClass("woocommerce-checkout"))
                           $("body").trigger("update_checkout");
                        else if ($("body").hasClass("woocommerce-cart"))
                           window.location.reload();
                        else $("body").trigger("update_checkout");
                     }, 200);
                  })
                  .fail(function () {
                     showMapMessage(
                        "Ошибка при сохранении зоны на сервере",
                        "error"
                     );
                  });
            } else {
               const msg =
                  WYD_SETTINGS.outside_zone_text ||
                  "Адрес вне зоны доставки — выберите другой способ доставки";
               showMapMessage(msg, "error");
               const $non = $('input[name^="shipping_method"]')
                  .filter(function () {
                     return (
                        String(this.value).indexOf(
                           WYD_SETTINGS.nonstandard_method_id ||
                              "yd_nonstandard"
                        ) === 0
                     );
                  })
                  .first();
               if ($non.length) $non.prop("checked", true).trigger("change");
               setZoneOnServer({ id: -1, price: 0, name: "Вне зоны" }).done(
                  function () {
                     if ($("body").hasClass("woocommerce-checkout"))
                        $("body").trigger("update_checkout");
                     else if ($("body").hasClass("woocommerce-cart"))
                        window.location.reload();
                     else $("body").trigger("update_checkout");
                  }
               );
            }
         })
         .fail(function () {
            showMapMessage("Ошибка проверки зоны", "error");
         });
   }

   function isValidAddress(address) {
      if (!address || address.trim() === "") return false;
      const streetPattern =
         /(ул\.|улица|проспект|пр\.|пр-т|переулок|пер\.|шоссе|набережная|бульвар|б-р|аллея|пл\.|площадь|проезд|тупик)/i;
      const housePattern =
         /(дом|д\.|домостроение|д\.?[\s]*\d|корпус|корп\.|к\.|строение|стр\.|с\.)/i;
      const hasNumber = /\d/;
      const hasStreet = streetPattern.test(address);
      const hasHouse =
         housePattern.test(address) ||
         (hasNumber && /(дом|д\.)?[\s]*\d+[а-я]?$/i.test(address));
      if (!hasStreet || !hasHouse) return false;
      return true;
   }

   function initMap() {
      if (map) return;
      if (typeof ymaps === "undefined" || !ymaps.ready) {
         setTimeout(initMap, 400);
         return;
      }
      ymaps.ready(function () {
         map = new ymaps.Map("delivery-map", {
            center: [55.75, 37.62],
            zoom: 9,
            controls: ["zoomControl", "searchControl"],
         });
         map.events.add("click", function (e) {
            const coords = e.get("coords");
            probeZoneByCoords(coords)
               .done(function (resp) {
                  if (resp && resp.success && resp.data && resp.data.zone)
                     showMapMessage(
                        `${resp.data.zone.name} (${resp.data.zone.price}₽)`,
                        "info"
                     );
                  else
                     showMapMessage(
                        WYD_SETTINGS.outside_zone_text ||
                           "Адрес вне зоны доставки",
                        "error"
                     );
               })
               .fail(function () {
                  showMapMessage("Ошибка при определении зоны", "error");
               });
         });
         $(document).on("blur", "#billing_address_1", function () {
            const address = $(this).val() || "";
            if (!address || !isValidAddress(address)) return;
            ymaps.geocode(address).then(function (res) {
               const first = res.geoObjects.get(0);
               if (!first) return;
               const coords = first.geometry.getCoordinates();
               if (!placemark) {
                  placemark = new ymaps.Placemark(
                     coords,
                     {},
                     { draggable: true }
                  );
                  map.geoObjects.add(placemark);
                  placemark.events.add("dragend", function () {
                     handleAddressByCoords(placemark.geometry.getCoordinates());
                  });
               } else placemark.geometry.setCoordinates(coords);
               map.setCenter(coords);
               checkZoneAndApply(coords, first.getAddressLine());
            });
         });
         loadZones().done(function (resp) {
            if (
               resp &&
               resp.success &&
               resp.data &&
               Array.isArray(resp.data.zones)
            )
               renderZones(resp.data.zones);
         });
      });
   }

   function applyShippingUI() {
      const selectedMethod =
         $('input[name^="shipping_method"]:checked').val() || "";
      const isCourier = String(selectedMethod).indexOf("yd_delivery_v2") === 0;
      let $map = $("#delivery-map");
      if (isCourier) {
         if (!$map.length) {
            $map = $(
               '<div id="delivery-map" style="width:100%;height:400px;margin-top:20px;border:1px solid #ddd"></div>'
            );
            $("body").append($map);
         }
         const $target = $('input[name^="shipping_method"]:checked').closest(
            "li"
         );
         if ($target.length) $target.after($map);
         $map.show();
         if (!map) {
            initMap();
            return;
         }
         try {
            if (
               map &&
               map.container &&
               typeof map.container.fitToViewport === "function"
            )
               map.container.fitToViewport();
            if (map && typeof map.getCenter === "function")
               map.setCenter(map.getCenter());
         } catch (e) {}
         loadZones().done(function (resp) {
            if (
               resp &&
               resp.success &&
               resp.data &&
               Array.isArray(resp.data.zones)
            )
               renderZones(resp.data.zones);
         });
      } else {
         if ($map.length) $map.hide();
         $("#wyd_address_message").remove();
         $("#wyd_zone_summary").remove();
      }
      const nonstandardID =
         WYD_SETTINGS.nonstandard_method_id || "yd_nonstandard";
      if (String(selectedMethod).indexOf(nonstandardID) === 0) {
         $.post(WYD_SETTINGS.ajax_url, {
            action: "wyd_get_cart_subtotal",
         }).done(function (resp) {
            const subtotal =
               resp && resp.success && resp.data && resp.data.subtotal
                  ? parseFloat(resp.data.subtotal)
                  : 0;
            if (subtotal < WYD_SETTINGS.min_nonstandard) {
               showMapMessage(
                  `Минимальная сумма для "МСК нестандартная доставка" — ${WYD_SETTINGS.min_nonstandard} ₽`,
                  "error"
               );
               $('input[name^="shipping_method"]')
                  .filter(function () {
                     return String(this.value).indexOf(nonstandardID) === 0;
                  })
                  .prop("disabled", true);
               $('input[name^="shipping_method"]')
                  .filter(function () {
                     return String(this.value).indexOf("yd_delivery_v2") === 0;
                  })
                  .first()
                  .prop("checked", true)
                  .trigger("change");
            } else {
               $('input[name^="shipping_method"]')
                  .filter(function () {
                     return String(this.value).indexOf(nonstandardID) === 0;
                  })
                  .prop("disabled", false);
               $("#wyd_address_message").remove();
            }
         });
      } else {
         $('input[name^="shipping_method"]')
            .filter(function () {
               return String(this.value).indexOf(nonstandardID) === 0;
            })
            .prop("disabled", false);
      }
   }

   function initShippingListeners() {
      if (shippingListenersInited) return;
      shippingListenersInited = true;
      $(document).on("change", 'input[name^="shipping_method"]', function () {
         applyShippingUI();
      });
      $(document.body).on(
         "updated_checkout updated_shipping_method updated_cart_totals",
         function () {
            setTimeout(applyShippingUI, 150);
         }
      );
      setTimeout(function () {
         applyShippingUI();
      }, 100);
   }

   $(function () {
      const $maps = $("#delivery-map");
      if ($maps.length > 1) $maps.slice(1).remove();
      initShippingListeners();
   });
})(jQuery);
