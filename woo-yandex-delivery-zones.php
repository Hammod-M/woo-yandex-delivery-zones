<?php

/*
Plugin Name: Woo Yandex Delivery Zones
Description: Yandex map delivery zones with admin visual editor (draw polygons/circles), automatic Yandex API loading and WooCommerce integration.
Version: 3.0
Author: HM
*/

if (!defined('ABSPATH'))
    exit;
if (!class_exists('WYD_Plugin_v2')) {
    class WYD_Plugin_v2
    {
        const OPTION_ZONES = 'wyd_v2_zones_json';
        const OPTION_SETTINGS = 'wyd_v2_settings';

        public function __construct()
        {
            register_activation_hook(__FILE__, array($this, 'on_activate'));
            add_action('admin_menu', array($this, 'admin_menu'));
            add_action('admin_post_wyd_save_zones', array($this, 'handle_admin_save'));
            add_action('wp_ajax_wyd_v2_get_zones', array($this, 'ajax_get_zones'));
            add_action('wp_ajax_nopriv_wyd_v2_get_zones', array($this, 'ajax_get_zones'));
            add_action('wp_ajax_wyd_v2_save_zones', array($this, 'ajax_save_zones'));
            add_action('wp_ajax_wyd_set_zone', array($this, 'ajax_set_zone'));
            add_action('wp_ajax_nopriv_wyd_set_zone', array($this, 'ajax_set_zone'));
            add_action('wp_ajax_wyd_check_zone_by_coords', array($this, 'ajax_check_zone_by_coords'));
            add_action('wp_ajax_nopriv_wyd_check_zone_by_coords', array($this, 'ajax_check_zone_by_coords'));
            add_action('admin_enqueue_scripts', array($this, 'admin_assets'));
            add_action('wp_enqueue_scripts', array($this, 'public_assets'));
            add_filter('woocommerce_shipping_methods', array($this, 'register_shipping_method'));
            add_action('woocommerce_shipping_init', 'wyd_v2_shipping_init');
            add_action('woocommerce_checkout_update_order_meta', array($this, 'save_order_meta'));
        }

        public function on_activate()
        {
            if (!get_option(self::OPTION_ZONES)) {
                $defaults = array();
                update_option(self::OPTION_ZONES, json_encode($defaults));
            }
            if (!get_option(self::OPTION_SETTINGS)) {
                $s = array(
                    'yandex_api_key' => '',
                    'outside_zone_price' => 1000,
                    'outside_zone_text' => '',
                    'min_nonstandard' => 5000
                );
                update_option(self::OPTION_SETTINGS, $s);
            }
        }

        public function admin_menu()
        {
            add_submenu_page('woocommerce', 'Yandex Delivery Zones', 'Yandex Delivery Zones', 'manage_options', 'wyd-v2-zones', array($this, 'admin_page'));
        }

        public function admin_assets($hook)
        {
            if ($hook !== 'woocommerce_page_wyd-v2-zones')
                return;
            $settings = get_option(self::OPTION_SETTINGS, array('yandex_api_key' => '', 'outside_zone_price' => 1000, 'outside_zone_text' => '', 'min_nonstandard' => 5000));
            if (!empty($settings['yandex_api_key'])) {
                wp_enqueue_script('ymaps_api_admin', 'https://api-maps.yandex.ru/2.1/?lang=ru_RU&apikey=' . esc_attr($settings['yandex_api_key']), array(), null, true);
            }
            wp_enqueue_style('wyd_v2_admin_css', plugins_url('admin/admin.css', __FILE__));
            wp_enqueue_script('wyd_v2_admin_js', plugins_url('admin/admin.js', __FILE__), array('jquery', 'ymaps_api_admin'), null, true);
            wp_localize_script('wyd_v2_admin_js', 'WYD_ADMIN', array(
                'ajax_url' => admin_url('admin-ajax.php'),
                'nonce' => wp_create_nonce('wyd_v2_nonce'),
                'get_zones_action' => 'wyd_v2_get_zones',
                'save_zones_action' => 'wyd_v2_save_zones',
                'settings' => $settings
            ));
        }

        public function public_assets()
        {
            if (!is_checkout() && !is_cart())
                return;
            $settings = get_option(self::OPTION_SETTINGS, array('yandex_api_key' => '', 'outside_zone_price' => 1000, 'outside_zone_text' => '', 'min_nonstandard' => 5000));
            if (!empty($settings['yandex_api_key'])) {
                wp_enqueue_script('ymaps_api', 'https://api-maps.yandex.ru/2.1/?lang=ru_RU&apikey=' . esc_attr($settings['yandex_api_key']), array(), null, true);
            }
            wp_enqueue_script('wyd_v2_public', plugins_url('public/delivery-map-v2.js', __FILE__), array('jquery', 'ymaps_api'), null, true);
            wp_enqueue_style('wyd_v2_public_css', plugins_url('public/style.css', __FILE__));
            wp_localize_script('wyd_v2_public', 'WYD_SETTINGS', array(
                'ajax_url' => admin_url('admin-ajax.php'),
                'nonce' => wp_create_nonce('wyd_v2_nonce'),
                'outside_zone_price' => floatval($settings['outside_zone_price']),
                'outside_zone_text' => $settings['outside_zone_text'],
                'min_nonstandard' => isset($settings['min_nonstandard']) ? floatval($settings['min_nonstandard']) : 5000,
                'nonstandard_method_id' => 'yd_nonstandard'
            ));
        }

        public function admin_page()
        {
            if (!current_user_can('manage_options'))
                return;
            $zones_json = get_option(self::OPTION_ZONES, '[]');
            $settings = get_option(self::OPTION_SETTINGS, array('yandex_api_key' => '', 'outside_zone_price' => 1000, 'outside_zone_text' => '', 'min_nonstandard' => 5000));
            ?>
            <div class="wrap wyd-admin-wrap" style="position:relative;">
                <h1>Yandex Delivery Zones — Настройки</h1>
                <form method="post" action="<?php echo admin_url('admin-post.php'); ?>">
                    <input type="hidden" name="action" value="wyd_save_zones">
                    <?php wp_nonce_field('wyd_save_zones_action'); ?>
                    <h2>API ключ и настройки</h2>
                    <table class="form-table">
                        <tr>
                            <th>Yandex API Key</th>
                            <td><input type="text" name="yandex_api_key"
                                    value="<?php echo esc_attr($settings['yandex_api_key']); ?>" style="width:420px"></td>
                        </tr>
                        <tr>
                            <th>Цена по умолчанию (вне зон)</th>
                            <td><input type="text" name="outside_zone_price"
                                    value="<?php echo esc_attr($settings['outside_zone_price']); ?>" style="width:120px"> ₽</td>
                        </tr>
                        <tr>
                            <th>Минимальная сумма для "МСК нестандартная"</th>
                            <td><input type="number" name="min_nonstandard" id="wyd_zone_min_sum" min="0" step="1"
                                    value="<?php echo esc_attr($settings['min_nonstandard']); ?>" style="width:120px"> ₽</td>
                        </tr>
                        <tr>
                            <th>Текст при вне зоны</th>
                            <td><input type="text" name="outside_zone_text"
                                    value="<?php echo esc_attr($settings['outside_zone_text']); ?>" style="width:420px"></td>
                        </tr>
                    </table>

                    <h2>Визуальный редактор зон</h2>
                    <p>Ниже — карта. Используй кнопки: <strong>Добавить polygon</strong>, <strong>Редактировать</strong>,
                        <strong>Удалить</strong>, затем Сохранить зоны.
                    </p>

                    <div id="wyd_admin_map" style="height:480px;border:1px solid #ddd;margin-bottom:10px"></div>
                    <div class="wyd-controls" style="margin-bottom:10px;">
                        <button id="wyd_add_polygon" class="button">Добавить polygon</button>
                        <button id="wyd_edit_mode" class="button">Редактировать выбранную</button>
                        <button id="wyd_delete_selected" class="button">Удалить выбранную</button>
                        <button id="wyd_save_zones" class="button button-primary">Сохранить зоны</button>
                    </div>

                    <input type="hidden" name="wyd_zones_json" id="wyd_zones_json" value='<?php echo esc_attr($zones_json); ?>'>
                </form>

                <hr>

                <h2>Текущие зоны (JSON)</h2>
                <textarea rows="10" style="width:100%;font-family:monospace"
                    id="wyd_zones_json_display"><?php echo esc_textarea($zones_json); ?></textarea>
                <p>Измени JSON вручную и нажми кнопку ниже, чтобы применить изменения на карте:</p>
                <button type="button" id="wyd_apply_json" class="button button-secondary">💾 Применить изменения из JSON</button>

                <div id="wyd_admin_sidebar"
                    style=" display:none; position:absolute; top:120px; right:40px; width:280px; background:#fff; border:1px solid #ccc; padding:15px; box-shadow:0 2px 10px rgba(0,0,0,0.1); z-index:10000; border-radius:8px; ">
                    <h3 style="margin-top:0;font-size:16px;">Редактирование зоны</h3>
                    <label>Название</label>
                    <input type="text" id="wyd_zone_name" style="width:100%;margin-bottom:8px;">
                    <label>Цена (₽)</label>
                    <input type="number" id="wyd_zone_price" style="width:100%;margin-bottom:8px;">
                    <label>Цвет</label>
                    <input type="color" id="wyd_zone_color" style="width:100%;margin-bottom:8px;">
                    <button id="wyd_zone_save" class="button button-primary" style="width:100%;">💾 Сохранить</button>
                    <button id="wyd_zone_close" class="button" style="width:100%;margin-top:6px;">Закрыть</button>
                </div>
            </div>
            <?php
        }

        public function handle_admin_save()
        {
            if (!current_user_can('manage_options'))
                wp_die('Forbidden');
            check_admin_referer('wyd_save_zones_action');

            $current = get_option(self::OPTION_SETTINGS, array(
                'yandex_api_key' => '',
                'outside_zone_price' => 1000,
                'outside_zone_text' => '',
                'min_nonstandard' => 5000,
            ));

            if (isset($_POST['wyd_zones_json'])) {
                $raw = wp_unslash($_POST['wyd_zones_json']);
                $decoded = json_decode($raw, true);
                if ($decoded !== null) {
                    $normalized = $this->normalize_zones($decoded);
                    if (!empty($normalized)) {
                        update_option(self::OPTION_ZONES, json_encode($normalized));
                    } else {
                        // if it's already an array of zones
                        update_option(self::OPTION_ZONES, json_encode($decoded));
                    }
                } else {
                    // invalid json - save raw to not lose user input
                    update_option(self::OPTION_ZONES, $raw);
                }
            }

            $new_settings = array(
                'yandex_api_key' => isset($_POST['yandex_api_key']) ? sanitize_text_field($_POST['yandex_api_key']) : $current['yandex_api_key'],
                'outside_zone_price' => isset($_POST['outside_zone_price']) ? floatval($_POST['outside_zone_price']) : floatval($current['outside_zone_price']),
                'outside_zone_text' => isset($_POST['outside_zone_text']) ? sanitize_text_field($_POST['outside_zone_text']) : $current['outside_zone_text'],
                'min_nonstandard' => isset($_POST['min_nonstandard']) ? floatval($_POST['min_nonstandard']) : (isset($current['min_nonstandard']) ? floatval($current['min_nonstandard']) : 5000),
            );

            update_option(self::OPTION_SETTINGS, $new_settings);

            wp_redirect(admin_url('admin.php?page=wyd-v2-zones&updated=true'));
            exit;
        }

        public function ajax_get_zones()
        {
            // публичный метод: возвращаем сохранённые зоны (используется на фронтенде)
            $zones_raw = get_option(self::OPTION_ZONES, '[]');
            $decoded = json_decode($zones_raw, true);
            $zones = $this->normalize_zones($decoded);
            wp_send_json_success(array('zones' => $zones));
        }

        public function ajax_save_zones()
        {
            if (!current_user_can('manage_options'))
                wp_send_json_error('no');
            check_ajax_referer('wyd_v2_nonce', 'nonce');
            $zones_raw = isset($_POST['zones']) ? wp_unslash($_POST['zones']) : '[]';
            $decoded = json_decode($zones_raw, true);
            if ($decoded !== null) {
                // normalize if needed
                $normalized = $this->normalize_zones($decoded);
                if (!empty($normalized)) {
                    update_option(self::OPTION_ZONES, json_encode($normalized));
                } else {
                    update_option(self::OPTION_ZONES, json_encode($decoded));
                }
            } else {
                // invalid JSON - save raw
                update_option(self::OPTION_ZONES, $zones_raw);
            }
            wp_send_json_success(array('saved' => true));
        }

        /**
         * AJAX: check which zone contains a given lat/lng
         * Expects POST: lat, lng
         */
        public function ajax_check_zone_by_coords()
        {
            $lat = isset($_POST['lat']) ? floatval($_POST['lat']) : null;
            $lng = isset($_POST['lng']) ? floatval($_POST['lng']) : null;

            if ($lat === null || $lng === null) {
                wp_send_json_error(array('error' => 'missing_coords'));
            }

            $zones_raw = get_option(self::OPTION_ZONES, '[]');
            $decoded = json_decode($zones_raw, true);
            $zones = $this->normalize_zones($decoded);

            foreach ($zones as $z) {
                if (!isset($z['coordinates']) || $z['type'] !== 'polygon')
                    continue;
                // polygon coordinates: [ [ [lon, lat], ... ] ] (rings)
                $rings = $z['coordinates'];
                foreach ($rings as $ring) {
                    if ($this->point_in_polygon($lng, $lat, $ring)) {
                        wp_send_json_success(array('zone' => $z));
                    }
                }
            }

            wp_send_json_error(array('zone' => null));
        }

        /**
         * Normalize various possible saved formats into plugin's expected zones array
         * Accepts either already-normalized array, or GeoJSON FeatureCollection, or legacy structures.
         */
        public function normalize_zones($raw)
        {
            if (empty($raw))
                return array();

            // If it's an object with 'features' -> treat as GeoJSON FeatureCollection
            if (isset($raw['type']) && $raw['type'] === 'FeatureCollection' && isset($raw['features']) && is_array($raw['features'])) {
                $out = array();
                foreach ($raw['features'] as $feature) {
                    if (!isset($feature['geometry']))
                        continue;
                    $geom = $feature['geometry'];
                    $props = isset($feature['properties']) ? $feature['properties'] : array();
                    $options = isset($feature['options']) ? $feature['options'] : array();

                    if ($geom['type'] === 'Polygon') {
                        // GeoJSON uses [ [ [lon, lat], ... ] ]
                        $coords = $geom['coordinates'];
                        $id = isset($feature['id']) ? $feature['id'] : (isset($props['insalesData']['object_id']) ? $props['insalesData']['object_id'] : null);
                        $name = isset($props['insalesData']['title']) ? $props['insalesData']['title'] : (isset($props['title']) ? $props['title'] : 'Зона');
                        $price = isset($props['insalesData']['price']) ? floatval($props['insalesData']['price']) : (isset($props['price']) ? floatval($props['price']) : 0);
                        $color = isset($options['fillColor']) ? $options['fillColor'] : (isset($props['color']) ? $props['color'] : '#00ff0088');
                        $min_sum = isset($props['min_sum']) ? floatval($props['min_sum']) : 0;
                        // preserve stroke/fill options from original GeoJSON if present
                        // initialize style variables (avoid unassigned variable warnings)
                        $fillOpacity = null;
                        $strokeColor = null;
                        $strokeWidth = null;
                        if (isset($options['fillOpacity'])) {
                            $fillOpacity = floatval($options['fillOpacity']);
                        } elseif (isset($props['fillOpacity'])) {
                            $fillOpacity = floatval($props['fillOpacity']);
                        }
                        if (isset($options['strokeColor'])) {
                            $strokeColor = $options['strokeColor'];
                        } elseif (isset($props['strokeColor'])) {
                            $strokeColor = $props['strokeColor'];
                        }
                        if (isset($options['strokeWidth'])) {
                            $strokeWidth = $options['strokeWidth'];
                        } elseif (isset($props['strokeWidth'])) {
                            $strokeWidth = $props['strokeWidth'];
                        }

                        $out[] = array(
                            'id' => $id ?: uniqid(),
                            'name' => $name,
                            'price' => $price,
                            'min_sum' => $min_sum,
                            // keep original styling where possible
                            'color' => $color,
                            'fillOpacity' => ($fillOpacity !== null) ? $fillOpacity : null,
                            'strokeColor' => ($strokeColor !== null) ? $strokeColor : null,
                            'strokeWidth' => ($strokeWidth !== null) ? $strokeWidth : null,
                            'type' => 'polygon',
                            'coordinates' => $coords,
                        );
                    }
                }
                return $out;
            }

            // If already array of zones in expected shape
            if (is_array($raw)) {
                // Quick validation: if first element has 'type' and 'coordinates'
                $first = reset($raw);
                if ($first && isset($first['type']) && isset($first['coordinates'])) {
                    return $raw;
                }
            }

            return array();
        }

        /**
         * Point in polygon test (ray casting).
         * polygon: array of [ [lon, lat], ... ]
         */
        private function point_in_polygon($x, $y, $polygon)
        {
            $inside = false;
            $j = count($polygon) - 1;
            for ($i = 0; $i < count($polygon); $i++) {
                $xi = floatval($polygon[$i][0]);
                $yi = floatval($polygon[$i][1]);
                $xj = floatval($polygon[$j][0]);
                $yj = floatval($polygon[$j][1]);

                $intersect = ((($yi > $y) != ($yj > $y)) && ($x < ($xj - $xi) * ($y - $yi) / ($yj - $yi + 0.0) + $xi));
                if ($intersect)
                    $inside = !$inside;
                $j = $i;
            }
            return $inside;
        }

        public function ajax_set_zone()
        {
            check_ajax_referer('wyd_v2_nonce', 'nonce');
            if (!function_exists('WC') || !WC()->session) {
                if (function_exists('WC') && isset(WC()->session)) {
                } else {
                    wp_send_json_error(array('error' => 'no_session'));
                }
            }

            $zone_id = isset($_POST['zone_id']) ? intval($_POST['zone_id']) : 0;
            $zone_price = isset($_POST['zone_price']) ? floatval($_POST['zone_price']) : 0;

            if ($zone_id === -1) {
                WC()->session->set('wyd_v2_unavailable', true);
                WC()->session->set('wyd_v2_zone_id', null);
                WC()->session->set('wyd_v2_zone_price', null);
            } else {
                WC()->session->set('wyd_v2_unavailable', false);
                WC()->session->set('wyd_v2_zone_id', $zone_id);
                WC()->session->set('wyd_v2_zone_price', $zone_price);
            }

            wp_send_json_success(array('ok' => true));
        }

        public function register_shipping_method($methods)
        {
            $methods['yd_delivery_v2'] = 'WC_YD_Shipping_Method_v2';
            $methods['yd_pickup'] = 'WC_YD_Pickup_Method';
            $methods['yd_nonstandard'] = 'WC_YD_NonStandard_Method';
            return $methods;
        }

        public function save_order_meta($order_id)
        {
            if (WC()->session) {
                $zone_id = WC()->session->get('wyd_v2_zone_id');
                $zone_price = WC()->session->get('wyd_v2_zone_price');
                if ($zone_id !== null || $zone_price !== null) {
                    update_post_meta($order_id, '_wyd_v2_zone_id', sanitize_text_field($zone_id));
                    update_post_meta($order_id, '_wyd_v2_zone_price', sanitize_text_field($zone_price));
                }
            }
        }

        public function ajax_get_cart_subtotal()
        {
            if (!function_exists('WC')) {
                wp_send_json_error();
            }
            $subtotal = 0;
            if (WC()->cart) {
                $subtotal = WC()->cart->subtotal;
            } else {
                $subtotal = 0;
            }
            wp_send_json_success(array('subtotal' => $subtotal));
        }
    }
}

if (!function_exists('wyd_v2_render_delivery_map')) {
    function wyd_v2_render_delivery_map()
    {
        static $wyd_map_rendered = false;
        if ($wyd_map_rendered)
            return;
        $wyd_map_rendered = true;
        echo '<div id="delivery-map" style="width:100%;height:400px;margin-top:20px;border:1px solid #ddd"></div>';
    }
}

add_action('woocommerce_after_checkout_form', 'wyd_v2_render_delivery_map');
add_action('woocommerce_after_cart_totals', 'wyd_v2_render_delivery_map');

if (class_exists('WYD_Plugin_v2')) {
    if (empty($GLOBALS['wyd_v2_plugin_instance'])) {
        $GLOBALS['wyd_v2_plugin_instance'] = new WYD_Plugin_v2();
        if (isset($GLOBALS['wyd_v2_plugin_instance']) && $GLOBALS['wyd_v2_plugin_instance'] instanceof WYD_Plugin_v2) {
            add_action('wp_ajax_wyd_get_cart_subtotal', array($GLOBALS['wyd_v2_plugin_instance'], 'ajax_get_cart_subtotal'));
            add_action('wp_ajax_nopriv_wyd_get_cart_subtotal', array($GLOBALS['wyd_v2_plugin_instance'], 'ajax_get_cart_subtotal'));
        }
    }
}

if (!function_exists('wyd_v2_shipping_init')) {
    function wyd_v2_shipping_init()
    {
        if (!class_exists('WC_YD_Shipping_Method_v2')) {
            class WC_YD_Shipping_Method_v2 extends WC_Shipping_Method
            {
                public function __construct($instance_id = 0)
                {
                    $this->id = 'yd_delivery_v2';
                    $this->instance_id = absint($instance_id);
                    $this->method_title = 'Курьер по Москве и МО';
                    $this->method_description = 'Доставка по зонам, определяемым на карте Yandex.';
                    $this->enabled = "yes";
                    $this->title = "Курьер по Москве и МО";
                    $this->supports = array('shipping-zones', 'instance-settings', 'instance-settings-modal');
                    $this->init();
                }

                public function init()
                {
                    $this->init_form_fields();
                    $this->init_settings();
                    add_action('woocommerce_update_options_shipping_' . $this->id, array($this, 'process_admin_options'));
                }

                public function init_form_fields()
                {
                    $this->form_fields = array(
                        'enabled' => array(
                            'title' => 'Включить',
                            'type' => 'checkbox',
                            'default' => 'yes'
                        ),
                        'title' => array(
                            'title' => 'Заголовок',
                            'type' => 'text',
                            'default' => $this->title
                        ),
                    );
                }

                public function calculate_shipping($package = array())
                {
                    $cost = 0;
                    $min_price = 500;
                    $max_price = 2500;

                    // Здесь можно добавить логику расчета реальных мин/макс цен из зон
                    $zones_raw = json_decode(get_option(WYD_Plugin_v2::OPTION_ZONES, '[]'), true);
                    if (!empty($zones_raw) && is_array($zones_raw)) {
                        // normalize possible geojson
                        if (isset($GLOBALS['wyd_v2_plugin_instance']) && $GLOBALS['wyd_v2_plugin_instance'] instanceof WYD_Plugin_v2) {
                            $zones = $GLOBALS['wyd_v2_plugin_instance']->normalize_zones($zones_raw);
                        } else {
                            $zones = $zones_raw;
                        }

                        if (!empty($zones)) {
                            $prices = array_column($zones, 'price');
                            if (!empty($prices)) {
                                $min_price = min($prices);
                                $max_price = max($prices);
                            }
                        }
                    }

                    if (WC()->session) {
                        $price = WC()->session->get('wyd_v2_zone_price');
                        if ($price !== null && $price > 0) {
                            $cost = floatval($price);
                            $min_price = $cost;
                            $max_price = $cost;
                        }
                    }

                    $label = $this->title . ' ' . $min_price . ' ₽ - ' . $max_price . ' ₽';

                    $rate = array(
                        'id' => $this->id,
                        'label' => $label,
                        'cost' => $cost,
                        'meta_data' => array(
                            'description' => 'Доставка в пределах Москвы и Московской области'
                        )
                    );

                    $this->add_rate($rate);
                }
            }
        }

        if (!class_exists('WC_YD_Pickup_Method')) {
            class WC_YD_Pickup_Method extends WC_Shipping_Method
            {
                public function __construct($instance_id = 0)
                {
                    $this->id = 'yd_pickup';
                    $this->instance_id = absint($instance_id);
                    $this->method_title = 'Самовывоз';
                    $this->enabled = 'yes';
                    $this->title = 'Самовывоз';
                    $this->supports = array('shipping-zones', 'instance-settings', 'instance-settings-modal');
                    $this->init();
                }

                public function init()
                {
                    $this->init_form_fields();
                    $this->init_settings();
                    add_action('woocommerce_update_options_shipping_' . $this->id, array($this, 'process_admin_options'));
                }

                public function init_form_fields()
                {
                    $this->form_fields = array(
                        'enabled' => array(
                            'title' => 'Включить',
                            'type' => 'checkbox',
                            'default' => 'yes'
                        ),
                        'title' => array(
                            'title' => 'Заголовок',
                            'type' => 'text',
                            'default' => $this->title
                        ),
                    );
                }

                public function calculate_shipping($package = array())
                {
                    $rate = array(
                        'id' => $this->id,
                        'label' => $this->title,
                        'cost' => 0,
                        'meta_data' => array(
                            'description' => 'Самовывоз из нашего пункта выдачи'
                        )
                    );
                    $this->add_rate($rate);
                }
            }
        }

        if (!class_exists('WC_YD_NonStandard_Method')) {
            class WC_YD_NonStandard_Method extends WC_Shipping_Method
            {
                public function __construct($instance_id = 0)
                {
                    $this->id = 'yd_nonstandard';
                    $this->instance_id = absint($instance_id);
                    $this->method_title = 'МСК нестандартная доставка';
                    $this->method_description = 'Для расчета стоимости доставки с вами свяжется менеджер';
                    $this->enabled = 'yes';
                    $this->title = 'МСК нестандартная доставка';
                    $this->supports = array('shipping-zones', 'instance-settings', 'instance-settings-modal');
                    $this->init();
                }

                public function init()
                {
                    $this->init_form_fields();
                    $this->init_settings();
                    add_action('woocommerce_update_options_shipping_' . $this->id, array($this, 'process_admin_options'));
                }

                public function init_form_fields()
                {
                    $this->form_fields = array(
                        'enabled' => array(
                            'title' => 'Включить',
                            'type' => 'checkbox',
                            'default' => 'yes'
                        ),
                        'title' => array(
                            'title' => 'Заголовок',
                            'type' => 'text',
                            'default' => $this->title
                        ),
                    );
                }

                public function calculate_shipping($package = array())
                {
                    $rate = array(
                        'id' => $this->id,
                        'label' => $this->title . ' — Для расчета стоимости с вами свяжется менеджер',
                        'cost' => 0,
                        'meta_data' => array(
                            'description' => 'Для расчета стоимости доставки с вами свяжется менеджер'
                        )
                    );
                    $this->add_rate($rate);
                }
            }
        }
    }
}
