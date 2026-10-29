(function ($) {
   let map;
   let geoObjects = []; // { id, name, price, color, type, obj }
   let selectedPolygon = null;

   // helper: convert hex to rgba with given opacity (top-level so other functions can use it)
   function hexToRgba(hex, opacity) {
      if (!hex) return null;
      const h = hex.replace("#", "");
      let r, g, b;
      if (h.length === 3) {
         r = parseInt(h[0] + h[0], 16);
         g = parseInt(h[1] + h[1], 16);
         b = parseInt(h[2] + h[2], 16);
      } else if (h.length >= 6) {
         r = parseInt(h.substring(0, 2), 16);
         g = parseInt(h.substring(2, 4), 16);
         b = parseInt(h.substring(4, 6), 16);
      } else return hex;
      return "rgba(" + r + "," + g + "," + b + "," + opacity + ")";
   }

   function initAdminMap() {
      if (typeof ymaps === "undefined" || !ymaps.ready) {
         setTimeout(initAdminMap, 500);
         return;
      }

      ymaps.ready(() => {
         map = new ymaps.Map("wyd_admin_map", {
            center: [55.75, 37.62],
            zoom: 9,
            controls: ["zoomControl", "searchControl"],
         });

         loadZonesFromServer();
         bindButtons();
      });
   }

   function bindButtons() {
      $("#wyd_add_polygon").on("click", function (e) {
         e.preventDefault();
         startDrawingPolygon();
      });

      $("#wyd_delete_selected").on("click", function (e) {
         e.preventDefault();
         if (!selectedPolygon) return alert("Сначала выберите зону на карте.");
         map.geoObjects.remove(selectedPolygon.obj);
         geoObjects = geoObjects.filter((g) => g.id !== selectedPolygon.id);
         selectedPolygon = null;
         updateJsonField();
      });

      $("#wyd_save_zones").on("click", function (e) {
         // Обновляем скрытое поле с JSON зон и разрешаем обычную отправку формы,
         // чтобы вместе с зонами сохранились и настройки (min_nonstandard и т.д.).
         updateJsonField();
         // НЕ вызывать e.preventDefault() — форма отправится на admin-post.php и выполнит handle_admin_save()
      });

      $("#wyd_edit_mode").on("click", function (e) {
         e.preventDefault();
         if (!selectedPolygon)
            return alert("Выберите зону для редактирования.");

         // Начинаем редактирование контура
         selectedPolygon.obj.editor.startEditing();

         $("#wyd_finish_edit").remove();
         $(
            '<button id="wyd_finish_edit" class="button">Закончить редактирование</button>'
         )
            .appendTo(".wyd-controls")
            .on("click", function () {
               selectedPolygon.obj.editor.stopEditing();
               $("#wyd_finish_edit").remove();
               updateJsonField();
            });
      });

      // Применить JSON из textarea -> перерисовать + сохранить
      $("#wyd_apply_json").on("click", function () {
         const raw = $("#wyd_zones_json_display").val();
         let parsed = null;

         // Try parse, if fails attempt simple sanitize of trailing commas
         try {
            parsed = JSON.parse(raw);
         } catch (e) {
            try {
               const sanitized = raw.replace(/,\s*([}\]])/g, "$1");
               parsed = JSON.parse(sanitized);
            } catch (e2) {
               return alert("Ошибка в JSON: " + e.message);
            }
         }

         // If parsed is FeatureCollection (GeoJSON), convert to plugin zones format
         let zonesArr = [];
         if (Array.isArray(parsed)) {
            zonesArr = parsed;
         } else if (
            parsed &&
            parsed.type === "FeatureCollection" &&
            Array.isArray(parsed.features)
         ) {
            parsed.features.forEach(function (feature) {
               if (!feature.geometry) return;
               if (feature.geometry.type !== "Polygon") return;
               const coords = feature.geometry.coordinates; // [ [ [lon, lat], ... ] ]
               const props = feature.properties || {};
               const options = feature.options || {};

               const id =
                  feature.id ||
                  (props.insalesData && props.insalesData.object_id) ||
                  Date.now();
               const name =
                  (props.insalesData && props.insalesData.title) ||
                  props.title ||
                  props.name ||
                  "Зона";
               const price =
                  parseFloat(
                     (props.insalesData && props.insalesData.price) ||
                        props.price ||
                        0
                  ) || 0;
               const color =
                  options.fillColor ||
                  props.fillColor ||
                  props.color ||
                  "#00ff0088";
               const fillOpacity =
                  typeof options.fillOpacity !== "undefined"
                     ? parseFloat(options.fillOpacity)
                     : typeof props.fillOpacity !== "undefined"
                     ? parseFloat(props.fillOpacity)
                     : null;
               const strokeColor =
                  options.strokeColor || props.strokeColor || null;
               const strokeWidth =
                  options.strokeWidth || props.strokeWidth || null;
               const min_sum = props.min_sum || 0;

               zonesArr.push({
                  id: id,
                  name: name,
                  price: price,
                  min_sum: min_sum,
                  color: color,
                  fillOpacity: fillOpacity,
                  strokeColor: strokeColor,
                  strokeWidth: strokeWidth,
                  type: "polygon",
                  coordinates: coords,
               });
            });
         } else {
            return alert(
               "JSON должен быть массивом зон или GeoJSON FeatureCollection"
            );
         }

         // Render and save
         renderZones(zonesArr);
         $("#wyd_zones_json").val(JSON.stringify(zonesArr));
         // POST save
         $.post(
            WYD_ADMIN.ajax_url,
            {
               action: WYD_ADMIN.save_zones_action,
               nonce: WYD_ADMIN.nonce,
               zones: JSON.stringify(zonesArr),
            },
            function (resp) {
               if (resp.success) {
                  alert("✅ Зоны обновлены и сохранены!");
               } else {
                  alert("⚠️ Ошибка при сохранении зон на сервере");
               }
            }
         );
      });

      // Скрыть панель при клике вне
      $(document).on("click", function (e) {
         if (
            !$(e.target).closest(
               "#wyd_admin_sidebar, .ymaps-map, .wyd-controls"
            ).length
         ) {
            $("#wyd_admin_sidebar").hide();
         }
      });
   }

   function loadZonesFromServer() {
      $.post(
         WYD_ADMIN.ajax_url,
         { action: WYD_ADMIN.get_zones_action, _ajax_nonce: WYD_ADMIN.nonce },
         function (resp) {
            if (resp.success) {
               const zones = resp.data.zones || [];
               renderZones(zones);
               $("#wyd_zones_json_display").val(JSON.stringify(zones, null, 2));
               $("#wyd_zones_json").val(JSON.stringify(zones));
            } else {
               $("#wyd_zones_json_display").val("[]");
               $("#wyd_zones_json").val("[]");
            }
         }
      );
   }

   function renderZones(zones) {
      clearMap();
      if (!Array.isArray(zones)) return;
      zones.forEach((z) => {
         if (z.type !== "polygon") return;
         addPolygonToMap(z, false);
      });
      updateJsonField();
   }

   function clearMap() {
      geoObjects.forEach((g) => {
         try {
            map.geoObjects.remove(g.obj);
         } catch (e) {}
      });
      geoObjects = [];
      selectedPolygon = null;
      $("#wyd_admin_sidebar").hide();
   }

   function startDrawingPolygon() {
      alert(
         "Кликните по карте, чтобы нарисовать зону. Для завершения нажмите кнопку 'Закончить рисование'."
      );

      const polygon = new ymaps.Polygon(
         [],
         { hintContent: "Новая зона" },
         {
            fillColor: "#ff000044",
            strokeColor: "#ff0000",
            strokeWidth: 2,
         }
      );

      map.geoObjects.add(polygon);
      polygon.editor.startDrawing();

      $(
         '<button id="wyd_finish_poly" class="button">Закончить рисование</button>'
      )
         .appendTo(".wyd-controls")
         .on("click", function () {
            polygon.editor.stopDrawing();
            $("#wyd_finish_poly").remove();

            const coords = polygon.geometry.getCoordinates()[0];
            if (!coords || coords.length < 3) {
               map.geoObjects.remove(polygon);
               alert("Нужно минимум 3 точки для полигона!");
               return;
            }

            const name = prompt("Название зоны:", "Район Москвы") || "Зона";
            const price =
               parseFloat(prompt("Цена доставки (₽):", "500")) || 500;
            // default color: use color input friendly hex
            let colorPrompt =
               prompt("Цвет зоны (hex, например #00ff00):", "#00ff00") ||
               "#00ff00";
            // store with alpha for visual: add '88' alpha if user provided 6-char hex
            if (colorPrompt.length === 7) colorPrompt = colorPrompt + "88";

            const zone = {
               id: Date.now(),
               name,
               price,
               color: colorPrompt,
               type: "polygon",
               coordinates: [coords.map((p) => [p[1], p[0]])],
            };

            addPolygonToMap(zone, true);
            map.geoObjects.remove(polygon);
            updateJsonField();
         });
   }

   function addPolygonToMap(zone, select) {
      if (!zone || !zone.coordinates || !zone.coordinates[0]) return;
      const coords = zone.coordinates[0].map((p) => [p[1], p[0]]);
      // determine fill color, respect fillOpacity if provided
      let fill = zone.color || "#00ff0088";
      if (zone.fillOpacity !== undefined && zone.fillOpacity !== null) {
         // if color is hex, convert to rgba
         if (/^#/.test(fill)) {
            fill = hexToRgba(
               fill.replace(/..$/, ""),
               parseFloat(zone.fillOpacity)
            );
         } else {
            // leave as-is
         }
      }
      const polygon = new ymaps.Polygon(
         [coords],
         {
            hintContent: `${zone.name} (${zone.price}₽)`,
            balloonContent: `<b>${zone.name}</b><br>Цена: ${zone.price}₽`,
         },
         {
            fillColor: fill,
            strokeColor: zone.strokeColor || "#000",
            strokeWidth: zone.strokeWidth ? parseFloat(zone.strokeWidth) : 2,
            draggable: true,
         }
      );

      map.geoObjects.add(polygon);
      const obj = {
         id: zone.id,
         name: zone.name,
         price: zone.price,
         color: zone.color,
         fillOpacity: zone.fillOpacity || null,
         strokeColor: zone.strokeColor || null,
         strokeWidth: zone.strokeWidth || null,
         type: "polygon",
         obj: polygon,
      };
      geoObjects.push(obj);

      polygon.events.add("click", function () {
         selectPolygon(obj);
      });

      polygon.events.add("dragend", function () {
         updateJsonField();
      });

      // if polygon supports editor, update JSON when editing stops
      if (polygon.editor) {
         polygon.editor.events.add("editingend", function () {
            updateJsonField();
         });
      }

      if (select) selectPolygon(obj);
   }

   function selectPolygon(obj) {
      selectedPolygon = obj;
      geoObjects.forEach((g) => g.obj.options.set("strokeWidth", 2));
      obj.obj.options.set("strokeWidth", 5);
      showEditPanel(obj);
   }

   function updateJsonField() {
      const zones = geoObjects.map((g) => {
         const coords = (g.obj.geometry.getCoordinates() || [])[0] || [];
         const coordsLngLat = coords.map((p) => [p[1], p[0]]);
         return {
            id: g.id,
            name: g.name,
            price: g.price,
            min_sum: g.min_sum || 0,
            color: g.color,
            fillOpacity:
               typeof g.fillOpacity !== "undefined" ? g.fillOpacity : null,
            strokeColor:
               typeof g.strokeColor !== "undefined" ? g.strokeColor : null,
            strokeWidth:
               typeof g.strokeWidth !== "undefined" ? g.strokeWidth : null,
            type: "polygon",
            coordinates: [coordsLngLat],
         };
      });

      $("#wyd_zones_json").val(JSON.stringify(zones));
      $("#wyd_zones_json_display").val(JSON.stringify(zones, null, 2));
   }

   function saveZonesToServer() {
      const zones = $("#wyd_zones_json").val() || "[]";
      $.post(
         WYD_ADMIN.ajax_url,
         {
            action: WYD_ADMIN.save_zones_action,
            nonce: WYD_ADMIN.nonce,
            zones: zones,
         },
         function (resp) {
            if (resp.success) alert("Зоны успешно сохранены!");
            else alert("Ошибка при сохранении.");
         }
      );
   }

   // === Панель редактирования зоны ===
   function showEditPanel(zoneObj) {
      $("#wyd_admin_sidebar").show();
      $("#wyd_zone_name").val(zoneObj.name || "");
      $("#wyd_zone_price").val(zoneObj.price || 0);
      $("#wyd_zone_min_sum").val(zoneObj.min_sum || 0);

      // set color input (hex without alpha if possible)
      let hex = "#00ff00";
      if (zoneObj.color) {
         // try to extract 6-char hex
         const c = zoneObj.color.replace("#", "");
         if (c.length >= 6) hex = "#" + c.slice(0, 6);
      }
      $("#wyd_zone_color").val(hex);

      $("#wyd_zone_save")
         .off("click")
         .on("click", function () {
            zoneObj.name = $("#wyd_zone_name").val();
            zoneObj.price = parseFloat($("#wyd_zone_price").val()) || 0;
            const chosen = $("#wyd_zone_color").val() || "#00ff00";
            zoneObj.color = chosen.length === 7 ? chosen + "88" : chosen;
            zoneObj.min_sum = parseFloat($("#wyd_zone_min_sum").val()) || 0;

            // update polygon visual and properties
            try {
               zoneObj.obj.options.set("fillColor", zoneObj.color);
               zoneObj.obj.properties.set({
                  hintContent: `${zoneObj.name} (${zoneObj.price}₽)`,
                  balloonContent: `<b>${zoneObj.name}</b><br>Цена: ${zoneObj.price}₽`,
               });
            } catch (e) {}

            updateJsonField();

            // auto-save to server (AJAX)
            $.post(
               WYD_ADMIN.ajax_url,
               {
                  action: WYD_ADMIN.save_zones_action,
                  nonce: WYD_ADMIN.nonce,
                  zones: $("#wyd_zones_json").val(),
               },
               function (resp) {
                  if (resp.success) {
                     alert("✅ Изменения применены и сохранены");
                  } else {
                     alert("⚠️ Ошибка при сохранении изменений");
                  }
               }
            );
         });

      $("#wyd_zone_close")
         .off("click")
         .on("click", function () {
            $("#wyd_admin_sidebar").hide();
         });
   }

   $(initAdminMap);
})(jQuery);
