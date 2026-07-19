# GNNcab — Yeniden İnşa Planı (Yalın · Bedava Altyapı · Mobil-Öncelikli)

> Durum: **KİLİTLİ / Kararlar tamamlandı** · Kodlama henüz başlamadı (kullanıcı onayı bekleniyor).
> Bu doküman `srs_architecture_doc.md`'yi (orijinal sistemin analizi) tamamlar ve ondan farklı bir yönü temsil eder.
> **North Star:** Kendi şirketi için basit bir Uber (10-20 sürücü), altyapısı **bedava** yayında kalan, **mobil-öncelikli**, hatasız, vergi/güvenlik için raporlayan bir sistem.

---

## 0. Bağlam (Neden bu plan böyle?)

- Orijinal proje 3 ay "vibe coding" ile büyüdü; 10.000 sürücülük ağır bir mimariye dönüştü (Redis, PostGIS, BullMQ, çok-worker). **Gerçek ihtiyaç bunun binde biri.**
- Kullanıcının asıl kısıtı: **işletme/altyapı maliyeti ≈ 0** olsun (Cloudflare free tier). Ödeme komisyonları ayrı işletme gideri olarak kabul edilir; "bedava" derken kastedilen backend+frontend'i yayında tutma maliyetidir.
- Mantık orijinaldeki gibi kalır ama **çok daha yalın** ve bedava koşan bir zemine oturur.

---

## 1. Kesinleşen Kararlar (LOCKED)

| # | Karar | Değer |
|---|---|---|
| L0 | İşletme & pazar | İşletme = **GNN LLC** (ABD şirketi). Yasal olarak **North Conway, NH, USA**'de çalışır; ödemeler/yönetim/her şey ABD'de. → USD, İngilizce, ABD (federal + NH) hukuku. |
| L1 | Ölçek | 10-20 sürücü; küçük, tek şirket. Ağır ölçek altyapısı YOK. |
| L2 | Altyapı maliyeti | Cloudflare **always-free** (Workers + D1 + Durable Objects + Pages + **R2** dosya depolama). |
| L3 | Yüzeyler | Mobil (tek app, rol bazlı) **+ web admin**. Giriş: **birleşik/yolcu-odaklı login**, role göre yönlendirme; sürücü/admin için ayrı buton YOK (aşağı L15). |
| L4 | Para | Çekirdek = ücret/yol **kaydı + admin raporu** (vergi/güvenlik). App-içi tahsilat sağlayıcı = **Stripe** (L14). Komisyon işletme gideri; infra bedava kalır. |
| L5 | Mantık | Orijinal iş kuralları (durum makinesi, dispatch) korunur; yalınlaştırılır. |
| L6 | Backend runtime | Cloudflare Workers (Node sunucusu YOK → aylık hosting maliyeti YOK). |
| L7 | Mobil paketleme | **Tek Flutter app, rol bazlı** (giriş sonrası yolcu/sürücü/admin ekranları). Bakımı en kolay. |
| L8 | Para birimi & mesafe | **USD** + **mil**. Ücret DB'de yapılandırma → **admin panelden anlık değiştirilebilir** (taban + mil başı; varsayılan $2.5 + $1.2). İleride şehir bazlı fiyat mümkün. |
| L9 | Web admin | **Eski React admin yeniden kullanılır** (Cloudflare Pages). Zaten React19/Vite/Tailwind/shadcn + cookie+CSRF auth → Pages'e uygun. Yeni Hono sözleşmesine göre API istemcisi yeniden üretilir; sürücü/yolcu sayfaları atılır. |
| L10 | Backend framework | **Hono** (Workers). Kesin. |
| L11 | Auth token | Access 15 dk (web: HttpOnly cookie + CSRF · mobil: güvenli depolama); refresh 30 gün rotasyonlu; `refresh_tokens` ile cihaz bazlı iptal; logout = refresh iptali. |
| L12 | Harita | Mobil: `flutter_map` + OSM karo (attribution). Web admin: mevcut Leaflet. Hacim artarsa MapTiler free tier'a geçilebilir. |
| L13 | Arayüz dili | **Tek dil: İngilizce.** i18n gerekmez. Eski admin zaten İngilizce. |
| L14 | Ödeme sağlayıcı | **Stripe** (GNN LLC ABD şirketi mevcut → Stripe kusursuz oturur; Connect ile sürücü payout). App-içi tahsilat = Faz 9; çekirdek önce kayıt/rapor. |
| L15 | Giriş & kayıt | Giriş ekranında **yolcu girişi belirgin**; **admin + sürücü girişi footer'da iki minik ikon**. **Sign up → rol seçimi** (I'm a passenger / I'm a driver). Passenger: telefon+e-posta+şifre (minimum veri). Driver: sözleşmeler + form + **belge yükleme**. Sürücüler kendileri üye olabilir. |
| L16 | Admin yetkileri | Admin panelinden **her şey**: manuel sürücü/yolcu ekleme, rol atama/değiştirme (üyeyi sürücü↔yolcu yapma), sürücü/yolcu iptal-pasifleştirme, yolculuk iptali, sürücü onayı, fiyat ayarı, raporlama. |
| L17 | Sürücü belgeleri | Kayıtta ehliyet + sabıka kaydı + fotoğraf yüklenir → **R2**'de saklanır. Onaydan sonra sürücü **silemez** (write-once, güvenlik/kayıt). Erişim sıkı (yalnız admin), hassas veri olarak korunur (L19). |
| L18 | Gizlilik | ABD (federal + NH) çerçevesi. **Veri minimizasyonu** (privacy-by-design): passenger'dan yalnızca gerekli alanlar. |
| L19 | Hassas belge güvenliği | Aktarım: TLS (otomatik). Depolama: R2 private + at-rest şifreli (otomatik). Üstüne **uygulama katmanı zarf şifreleme** (envelope): dosya rastgele veri anahtarıyla şifrelenir, anahtar Workers Secret ile sarılır. Görüntüleme yalnız **kimliği doğrulanmış admin/sahip** üzerinden, kısa ömürlü imzalı URL / Worker proxy ile. Her erişim **audit**lenir. |
| L20 | Saat dilimi | Depolama UTC; gösterim/rapor **America/New_York (ET)**. |
| L21 | Servis alanı | Tek şehir/servis alanı (North Conway). `cities`/`zones` şeması korunur ama **çok-şehir UI'ı şimdi yapılmaz** (ileriye açık). |
| L22 | Yedekleme & saklama | Finansal/yolculuk kayıtları vergi için uzun süre saklanır (ABD ~7 yıl). D1 Time Travel + periyodik **export** (ayrıca R2'ye yedek). |
| L23 | Repo yapısı | Tek monorepo: backend (Workers) + web admin (React) + **Flutter app** + paylaşılan sözleşme (OpenAPI→TS+Dart üretimi). |
| L24 | CI/CD | **GitHub Actions**: push → build → **otomatik Cloudflare deploy**. PR = typecheck+test+**preview deploy**; `main` merge = test → **D1 migration (öncesinde otomatik yedek)** → Workers deploy → Pages deploy. Elle deploy yok. |
| L25 | Sır yönetimi | Cloudflare API token + account ID → **GitHub Secrets**. Uygulama sırları (JWT, Stripe, R2, FCM) → **Workers Secrets** (repoya/GitHub'a asla girmez). |
| L27 | Alan adı topolojisi | **`api.nhtaxi.com`** → Workers (REST + WebSocket). **`admin.nhtaxi.com`** → Pages (web admin). Preview'lar otomatik `*.workers.dev` / `*.pages.dev`. Sürücü belgeleri için **public hostname yok** (R2 private → Worker proxy). `gnncab-` öneki kullanılmaz; `api`/`backend` ayrımı yok (tek Worker). **Landing kapsam dışı** — mevcut WordPress sitesi yayında, dokunulmaz. |
| L29 | DNS durumu | ✅ **Risk yok.** `nhtaxi.com` zaten Cloudflare'de kayıtlı ve yönetiliyor → nameserver taşıma **gerekmez**, WordPress/e-posta etkilenmez. Sadece yeni subdomain eklenir. **Dolu subdomain'ler: `app.`, `tracker.`** (mevcut Tracker uygulaması) — çakışmadan kaçınılır. |
| L30 | Kota paylaşımı | Cloudflare ücretsiz kotaları hesap genelindedir. **Mevcut Trackcar Cloudflare'de DEĞİL** (DigitalOcean VPS) → kotalarımızı tüketmiyor. Hesapta başka iş varsa izlenir. |
| L31 | Geçiş (cutover) | Mevcut **Trackcar** (ücretsiz 3. parti, sürücüler şu an kullanıyor) **geçicidir** — GNNcab canlı takip modülü onun yerini alır. Sıra: GNNcab devreye al → sürücüleri taşı → paralel doğrula → Trackcar emekli → **DO VPS iptal** (aylık maliyet biter) → `app.`/`tracker.` subdomain'leri serbest kalır. **VPS, GNNcab sahada kanıtlanmadan iptal edilmez.** |
| L28 | Cross-subdomain auth | Web admin farklı origin'den API çağırır → auth cookie domain **`.nhtaxi.com`**, CORS allowlist'te `https://admin.nhtaxi.com`. Mobil Bearer token kullanır (CORS dışı). DNS Cloudflare'de; Universal SSL ücretsiz. |
| L26 | Mobil test & yayın hattı | Flutter Cloudflare'e deploy **edilmez** (native build). **Önce:** CI'da **Android APK** derlenir → GitHub **artifact** olarak indirilir → **emülatörde test**. Tetikleyici: `main` push + manuel (`workflow_dispatch`). Başlangıçta **debug/imzasız** APK; emülatör için **x86_64 ABI dahil**. **Sonra:** imzalı release + mağaza (Play/App Store), sürücü/admin için dahili dağıtım. **iOS ertelenir** (macOS runner ücretsiz kotayı 10x tüketir + imzalama zorunlu). |
| L32 | Flutter Web önizleme | **Faz 7'de** (Flutter adımında) ele alınır. `flutter build web` → statik çıktı → **Cloudflare Pages**'e deploy → `preview.nhtaxi.com` (Trackcar `app.`/`tracker.`'ı kullandığı için geçici isim; cutover sonrası `app.nhtaxi.com`'a taşınabilir). Android Chrome / iOS Safari'den kurulumsuz canlı test imkânı — yolcu+admin akışları (harita, WebSocket, dispatch) tam test edilebilir. **Sınır:** arka planda sürücü GPS takibi ve push bildirim (FCM) web'de native kadar güvenilir değil (özellikle iOS Safari) → bunlar için L26'daki native APK/TestFlight hattı şart, web önizleme onun **yerine değil, ek**idir. Maliyet $0 (Pages zaten bedava; ayrıca macOS/Android SDK gerektirmez). |

---

## 2. Önerilen Mimari (Bedava Yığın)

| Katman | Teknoloji | Gerekçe / Free limit (doğrulandı, 2026) |
|---|---|---|
| Backend API | **Hono** (Workers üzerinde) | Workers-native, hafif, TS. Free: 100k istek/gün. |
| Veritabanı | **Cloudflare D1** (SQLite) + **Drizzle** | Free: 5 GB, 5M okuma/gün, 100k yazma/gün. Drizzle D1'i destekler. |
| Dosya depolama | **Cloudflare R2** | Sürücü belgeleri (ehliyet/sabıka/foto). Free: 10 GB, çıkış ücreti $0. |
| Canlı takip + timer | **Durable Objects** (WebSocket Hibernation + **Alarms**) | Free plan'e açık (1 GB/DO). Alarms → dayanıklı 60 sn dispatch timer. |
| Web admin | **Cloudflare Pages** | Statik host bedava. Eski React admin yeniden kullanılabilir. |
| Mobil | **Flutter** (yolcu / sürücü / admin) | Açık kaynak. Paketleme kararı → Bölüm 9. |
| Push bildirim | **Firebase FCM** | Bedava. |
| Harita + mesafe | **OpenStreetMap** karo + GPS izi (Haversine/trace) | Google Maps faturası yok. |
| Kimlik | JWT (web: HttpOnly cookie + CSRF · mobil: access+refresh token) | Workers-uyumlu. |

**Neden WebSocket, polling değil?** 20 sürücü HTTP ile 5 sn'de bir konum gönderse ~345k istek/gün → free tier aşılır. Durable Object üzerinden tek kalıcı WebSocket bağlantısı hem ucuz hem doğru.

---

## 3. Neyi Koruyoruz / Neyi Yeniden Yazıyoruz (Salvage)

| Parça | Karar |
|---|---|
| İş mantığı: durum makinesi, dispatch kuralları, rol/ownership kontrolleri | **Koru** — eski koddan taşı |
| DB varlık modeli (users, driver_profiles, trips, trip_events, payments, audit...) | **Koru** — SQLite/D1'e uyarla |
| Web admin arayüzü (React: dashboard, trips, users) | **Yeniden kullan** — Pages'te host et (opsiyonel: yenile) |
| Backend (Express/Node + Postgres) | **Yeniden yaz** — Hono/Workers + D1 |
| Realtime (in-memory ws + setTimeout + Redis) | **Yeniden yaz** — Durable Objects |
| Mobil | **Sıfırdan** — Flutter |

---

## 4. Fonksiyonel Kapsam (Yalın)

### 4.1. Kimlik, Kayıt & Roller
- **Giriş ekranı:** yolcu girişi belirgin/ön planda; **admin + sürücü girişi footer'da iki minik ikon**. Giriş sonrası role göre yönlendirme.
- **Sign up → rol seçimi:** "I'm a passenger" / "I'm a driver".
  - **Passenger:** telefon + e-posta + şifre — yalnızca gerekli minimum (veri minimizasyonu).
  - **Driver:** sözleşme/onay ekranları + form + **belge yükleme** (ehliyet, sabıka kaydı, fotoğraf → R2).
- **Sürücüler kendileri üye olabilir**; admin onaylar (`isVerified`).
- **Admin override:** admin herhangi bir üyeyi sürücü↔yolcu yapabilir/değiştirebilir; hesap açabilir/pasifleştirebilir.
- **Belge değişmezliği:** onaydan sonra sürücü belgeleri silemez (write-once).
- Admin hesapları: seed/başka admin tarafından açılır.
- Arayüz dili: **İngilizce** (tek dil).
- Web: cookie+CSRF; Mobil: access+refresh token.

### 4.2. Yolculuk Yaşam Döngüsü (durum makinesi korunur)
`REQUESTED → DRIVER_ASSIGNED → DRIVER_ACCEPTED → DRIVER_EN_ROUTE → DRIVER_ARRIVED → TRIP_STARTED → TRIP_COMPLETED` (+ `DRIVER_REJECTED`, `DRIVER_NO_RESPONSE`, `TIMEOUT`, `TRIP_CANCELLED`). Rol-kısıtlı geçişler + geçersiz geçiş reddi + `trip_events` audit trail.

### 4.3. Dispatch (yalın)
- En yakın `AVAILABLE` sürücü (Haversine, 10 mil), reddeden/timeout olanları hariç tut, maks 3 deneme.
- **60 sn kabul timer'ı → Durable Object Alarm** (dayanıklı, restart-güvenli, bedava).
- Bu ölçekte atomik seçim basit bir koşullu update / DO serileştirme ile sağlanır.

### 4.4. Canlı Takip
- Sürücü konumu → Durable Object WebSocket → yolcu + admin'e yayın.
- Rate-limit (ör. 30/60sn) korunur.

### 4.5. Ücret & Yol Logları
- Rota/mesafe: GPS izinden veya Haversine (bedava). Ücret: taban + mil başı (yapılandırılabilir).
- Her yolculuğun mesafesi, süresi, güzergâh izi, ücreti, ödeme yöntemi kaydedilir.

### 4.6. Admin Panel (yönetim + raporlama — çekirdek değer)
- **Yönetim:** manuel sürücü ekleme, yolcu ekleme, sürücü/yolcu iptal & pasifleştirme, yolculuk iptali, sürücü onayı (`isVerified`), şehir/bölge yönetimi.
- **Raporlama (vergi + güvenlik):** sürücü/yolcu bazında yolculuk & para dökümü, tarih aralığı, dışa aktarma (CSV/PDF).
- Audit log görüntüleme.

### 4.7. Bildirimler
- FCM push: sürücü atandı / yolda / vardı / başladı / bitti.

### 4.8. Ödeme (Stripe — sonraki faz)
- Çekirdek: nakit/kart kişiler arası → sistem sadece kaydeder/raporlar.
- İleride: **Stripe** ile app-içi tahsilat + **Stripe Connect** ile sürücü payout (modüler; Workers'tan HTTPS API, infra'yı bedava bırakır).
- GNN LLC (ABD) mevcut → Stripe hesabı sorunsuz açılır.

### 4.9. Yolculuk Talep Akışı (yolcu)
- **Adres/konum girişi:** haritadan seçim + adres arama. Ücretsiz geocoding: OSM **Nominatim** veya Photon (kullanım politikasına dikkat; düşük hacim uygun).
- **Ön ücret gösterimi:** rezervasyon öncesi tahmini mesafe + süre + ücret gösterilir (mevcut `estimateRoute` mantığı).
- **Sürücü ETA:** atama sonrası yolcuya yaklaşık varış süresi.
- **İptal:** durum makinesine göre; başlangıçta **iptal ücreti yok** (ileride admin-yapılandırılabilir).

### 4.10. Kendi Geçmişi (yolcu & sürücü)
- Yolcu: geçmiş yolculukları + makbuz (ücret, mesafe, tarih).
- Sürücü: tamamlanan görevleri + kazanç özeti (vergi için kendi kaydı).

---

## 5. Alan Modeli (D1/SQLite'a uyarlanmış)

Orijinal varlıklar korunur; PostgreSQL-özel tipler SQLite karşılıklarına çevrilir (enum → text+check, numeric → text/real, timestamp → integer/text, json → text). Varlıklar: `users`, `driver_profiles`, `customer_profiles`, `cities`, `zones`, `driver_zone_assignments`, `trips`, `trip_events`, `payments`, `audit_logs` + **yeni**:
- `devices/push_tokens` (FCM), `refresh_tokens` (cihaz bazlı oturum)
- **`driver_documents`** — tür (license/background/photo), R2 objesi, durum, yüklenme/onay zamanı; **write-once (silinemez)**
- **`pricing_config`** — taban ücret + mil başı (+ ops. şehir bazlı); admin panelden düzenlenir

İndeksler korunur (geo-index gereksiz — bu ölçekte önemsiz).

---

## 6. Maliyet Tablosu (Doğrulanmış Free Limitler)

| Servis | Free limit | 20 sürücü gerçekliği |
|---|---|---|
| Workers | 100k istek/gün | Rahat yeter |
| D1 | 5 GB, 5M okuma/gün, 100k yazma/gün | Yıllarca yeter |
| Durable Objects | Free plan (1 GB/DO), WebSocket + Alarms | Yeter |
| R2 (dosya) | 10 GB, çıkış ücreti $0 | Sürücü belgeleri sığar |
| Pages | Statik host bedava | — |
| Firebase FCM | Bedava | — |
| GitHub Actions (CI/CD) | 2.000 dk/ay (private), public sınırsız | Rahat yeter |
| **Aylık altyapı** | **≈ $0** | Ödeme komisyonları ayrı işletme gideri |

**Ek kazanım:** Cutover sonrası (L31) mevcut **DigitalOcean VPS iptal edilir** → Trackcar'ın aylık sunucu gideri de sıfırlanır.

---

## 7. Çözülen Eski Kusurlar

| Eski sorun | Yeni çözüm |
|---|---|
| In-memory `setTimeout` (restart'ta kayıp, çok-worker'da bozuk) | Durable Object **Alarms** (dayanıklı, bedava) |
| Dispatch yarış koşulu | DO serileştirme / koşullu update (bu ölçekte basit) |
| Bellekte O(n) geo tarama | 20 sürücüde önemsiz; PostGIS gereksiz |
| Çift doğruluk kaynağı (openapi.yaml ↔ Drizzle) | Hono zod-openapi → tek kaynaktan TS + Dart istemci |
| Aylık sunucu + Postgres maliyeti | Workers + D1 → **$0 altyapı** |

---

## 8. Faz Planı (Yalın)

- **Faz 0:** **git init + GitHub repo** (klasör şu an git deposu değil); monorepo iskeleti; Cloudflare hesap/proje + bindings (D1, R2, DO); **alan adı & DNS kurulumu** (`api` / `admin` custom domain, L27); **GitHub Actions CI/CD workflow** (Bölüm 13); D1 şema taslağı; sözleşme (zod-openapi) kurulumu.
- **Faz 1:** Kimlik & RBAC (web cookie + mobil token), audit temeli.
- **Faz 2:** Şehir/sürücü/yolcu profilleri + admin yönetimi.
- **Faz 3:** Trip yaşam döngüsü + dispatch (DO Alarms) + durum makinesi.
- **Faz 4:** Canlı takip (DO WebSocket).
- **Faz 5:** Ücret & yol logları + admin raporlama (vergi/güvenlik).
- **Faz 6:** FCM bildirimleri.
- **Faz 7:** Mobil app (Flutter, tek app): yolcu → sürücü → admin. CI'da APK artifact + **emülatör testi** döngüsü (L26 Aşama 1). Aynı fazda **Flutter Web önizleme** de kurulur (L32) — `preview.nhtaxi.com` üzerinden telefon tarayıcısından (Android Chrome/iOS Safari) kurulumsuz canlı test.
- **Faz 8:** Web admin (Pages) + sertleştirme (test, gözlemlenebilirlik, deploy).
- **Faz 9 (ops.):** Stripe ödeme + Connect payout modülü.
- **Faz 10 — Go-live & Cutover (L31):** sürücü onboarding (hesap açma, app kurulumu, kısa eğitim) → GNNcab ile Trackcar **paralel** çalıştırılıp doğrulama → Trackcar emekli → **DigitalOcean VPS iptal** → `app.`/`tracker.` subdomain temizliği. Geri dönüş planı: doğrulama bitene kadar Trackcar açık kalır.

---

## 9. Kararlar — HEPSİ KAPANDI ✅

Açık karar kalmadı. Tüm kararlar Bölüm 1'de LOCKED (L1–L14) olarak sabitlendi:

| Eski açık madde | Nereye kapandı |
|---|---|
| 9-A Backend framework | L10 — Hono |
| 9-B Mobil paketleme | L7 — Tek app, rol bazlı |
| 9-C Web admin | L9 — Eski React yeniden kullanılır |
| 9-D Auth token detayı | L11 — Access 15dk + refresh 30g rotasyonlu + cihaz iptali |
| 9-E Harita | L12 — flutter_map + OSM (web: Leaflet) |
| 9-F Para/mesafe | L8 — USD + mil, $2.5 + $1.2/mil |
| 9-G Dil | L13 — Tek dil İngilizce |
| 9-H Ödeme | L14 — **Stripe** (kesin) |

Ek kilitli kararlar: L0 (GNN LLC / North Conway NH), L15 (giriş/kayıt UX), L16 (admin yetkileri), L17 (sürücü belgeleri/R2/write-once), L18 (gizlilik), L19 (belge şifreleme), L20 (saat dilimi ET), L21 (tek servis alanı), L22 (yedek/saklama), L23 (monorepo).

**Plan durumu: KİLİTLİ.** Açık karar kalmadı. Sonraki adım = Faz 0 görev dökümü, ardından kodlama.

---

## 10. Sonraki Adım

Tüm kararlar kapandı; plan kilitli. Sıradaki iş:

1. **Faz 0 görev dökümü** — repo iskeleti, D1 şema taslağı, zod-openapi sözleşme kurulumu, CI/typecheck adımlarını somut görevlere böl.
2. (Opsiyonel) Eski React arayüzünü çalıştırıp görmek.
3. Kullanıcı onayıyla **kodlamaya başla** (Faz 0 → Faz 8 sırasıyla).

> Plan kilitli. Değişiklik gerekirse ilgili LOCKED satırı güncellenir.

---

## 11. Non-Functional Gereksinimler & Kalite

| Alan | Yaklaşım |
|---|---|
| **Güvenlik** | RBAC her uçta + ownership kontrolleri; web'de CSRF; rate-limit; güvenlik başlıkları. Sırlar **Workers Secrets**'ta (JWT secret, Stripe key, R2 kimlik, FCM key). Hassas belge şifreleme (L19). Tüm kritik işlemler audit'lenir. |
| **Test (hatasız hedefi)** | Birim: durum makinesi, dispatch, fiyat hesabı. Entegrasyon: auth, ödeme webhook. Sözleşme testi (OpenAPI ↔ istemci). Kritik akış için e2e. |
| **Gözlemlenebilirlik** | Yapısal log + Workers analytics; `health`/`ready` uçları. Mobil: **Firebase Crashlytics + Analytics** (bedava) → saha çökmelerini yakala. |
| **Dayanıklılık** | DO Alarms ile restart-güvenli dispatch; startup reconciliation; **idempotent Stripe webhook** işleme. |
| **Yedekleme & saklama** | L22 — D1 Time Travel + periyodik export (R2'ye), finansal kayıt ~7 yıl. |
| **Gizlilik** | L18 veri minimizasyonu; L19 belge güvenliği; erişim audit. |

---

## 12. Gap Analizi — Gözden Geçirme Notları (baştan sona tarama)

Planı uçtan uca taradım; eklenen/teyit edilen noktalar:

1. **Adres/geocoding** → 4.9'a eklendi (Nominatim/Photon, bedava).
2. **Ön ücret + ETA** → 4.9'a eklendi.
3. **Yolcu/sürücü kendi geçmişi & makbuz** → 4.10'a eklendi (admin raporundan ayrı).
4. **Saat dilimi** → L20 (America/New_York).
5. **Tek servis alanı** → L21 (çok-şehir UI ertelendi, şema korunur).
6. **Yedekleme/saklama (vergi)** → L22.
7. **Belge şifreleme** (sizin sorunuz) → L19.
8. **Repo yapısı** → L23 (monorepo).
9. **Yasal/uyum belgeleri** → Terms of Service, **Driver Agreement** (sürücü kayıt sözleşmeleri), Privacy Policy hazırlanmalı; App Store/Play **veri güvenliği beyanları**. Sürücü arka plan/sigorta operasyonel konu (belge toplanır, hukuki süreç GNN LLC'de).
10. **App dağıtımı** → Tek Flutter app 3 rol içerdiğinden mağaza incelemesinde karışık kitle sorusu çıkabilir; sürücü/admin tarafı **dahili dağıtım** (TestFlight / internal track) ile verilebilir — ~20 sürücü için halka açık sürücü listelemesi şart değil.
11. **Offline/bağlantı** → Sürücü sinyal kaybında konum tamponlama + WebSocket otomatik reconnect.
12. **İlk admin bootstrap** → Seed script ile ilk admin hesabı.
13. **Bildirim kanalı** → Şimdilik yalnız FCM push; e-posta (makbuz vb.) opsiyonel/sonraki.
14. **Derecelendirme (opsiyonel)** → `driver_profiles.rating` alanı var; yolcu↔sürücü puanlama ileride eklenebilir.

**Bilinçli kapsam-dışı (şimdilik):** surge/dinamik fiyat, promosyon kodu, çoklu durak, paylaşımlı yolculuk, sürücü kazanç ödemesi otomasyonu (Stripe Connect Faz 9'da).

> Tarama tamam — açık/unutulmuş kritik nokta kalmadı.

---

## 13. CI/CD & Deploy Akışı (GitHub Actions → Cloudflare)

**İlke:** Elle deploy yok. `main`'e giden her şey otomatik olarak derlenip Cloudflare'e çıkar.

### 13.1. Pipeline

| Tetikleyici | Adımlar |
|---|---|
| **Pull Request** | typecheck → lint → test → **preview deploy** (Workers preview + Pages preview URL) |
| **`main`'e merge** | typecheck → lint → test → **D1 yedek/export** → **D1 migration apply** → **Workers deploy** → **Pages deploy** |

### 13.2. Bileşen Deploy Yöntemleri
- **Workers (API) + Durable Objects** → `wrangler deploy` (`cloudflare/wrangler-action`). DO sınıf migration'ları `wrangler.toml`'da tanımlı.
- **Pages (web admin)** → `wrangler pages deploy` (tutarlılık için Pages Git entegrasyonu yerine aynı pipeline'da).
- **D1** → `wrangler d1 migrations apply`. **Migration öncesi otomatik export** (L22) — canlı finansal/vergi verisi korunur.
- **R2** → deploy gerekmez; yalnız binding.

### 13.3. Sırlar (L25)
| Sır | Nerede |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Secrets |
| JWT secret, Stripe key, R2 kimlik, FCM key | **Workers Secrets** (`wrangler secret put`) — repoda/GitHub'da tutulmaz |

### 13.4. Ortamlar
- `main` → **production**.
- PR → **preview** (izole URL; canlıya dokunmaz).
- Gerekirse ileride `staging` ortamı eklenebilir (Workers environments).

### 13.5. Mobil Hattı (L26) — APK artifact → emülatör testi

**Aşama 1 (şimdi): CI'da APK derle, indir, emülatörde test et**
- Workflow: `flutter test` (birim/widget) → `flutter build apk` → **artifact upload**.
- Tetikleyici: `main` push + **manuel** (`workflow_dispatch`) — istenildiğinde build alınabilir.
- **Debug/imzasız APK** ile başlanır (keystore kurulumu gerekmez).
- ⚠️ **Emülatör uyumu:** emülatörler çoğunlukla **x86_64**. Debug APK bunu içerir; release'de `--split-per-abi` kullanılırsa x86_64 dışarıda kalır → emülatöre yüklenmez. Test build'inde x86_64 dahil olmalı.
- Artifact saklama: GitHub varsayılan 90 gün (yeterli).

**Aşama 2 (sonra): mağaza yayını**
- İmzalı release APK/AAB (keystore → GitHub Secrets).
- Play internal / TestFlight ile sürücü-admin dahili dağıtımı; yolcu tarafı halka açık.

**iOS:** Ertelendi. macOS runner ücretsiz kotadan **10x** tüketir (2.000 dk ≈ 200 dk macOS) + sertifika/imzalama zorunlu. Android akışı oturduktan sonra ele alınır.

**Aşama 3 (Faz 7'de, L32): Flutter Web önizleme — Pages'e deploy**
- Workflow: `flutter build web` → `wrangler pages deploy build/web --project-name=gnncab-preview`.
- Hedef: `preview.nhtaxi.com` (Trackcar `app.`/`tracker.`'ı kullandığından geçici isim — cutover sonrası `app.nhtaxi.com`'a taşınabilir, bkz 13.6).
- Amaç: telefonda kurulum olmadan (Android Chrome / iOS Safari) hızlı görsel/UX testi — yolcu ve admin akışları (harita, WebSocket, dispatch, canlı takip) tam çalışır.
- **Native'in yerine değil, eki:** sürücünün arka planda GPS takibi ve FCM push bildirimi web'de native kadar güvenilir değildir (iOS Safari'de push yalnız "Ana Ekrana Ekle" ile çalışır, arka plan konumu çok kısıtlı) → bu ikisi için L26'daki APK/TestFlight hattı zorunlu kalır.
- Maliyet: $0 — Pages zaten bedava, ek olarak macOS/Android SDK runner'ı gerektirmez (APK/iOS build'inden bile ucuz).

### 13.6. Alan Adı & Ortam Topolojisi (L27, L28)

> `nhtaxi.com` zaten Cloudflare'de yönetiliyor → DNS geçişi gerekmez, yalnız subdomain eklenir.

| Yüzey | Production | Preview (otomatik) | Ürün |
|---|---|---|---|
| API (REST + **WebSocket**) | `api.nhtaxi.com` | `<hash>.workers.dev` | Workers custom domain |
| Web admin | `admin.nhtaxi.com` | `<hash>.pages.dev` | Pages custom domain |
| Sürücü belgeleri | **public host yok** | — | R2 private → Worker proxy + imzalı URL |
| Flutter Web önizleme (Faz 7, L32) | `preview.nhtaxi.com` | `<hash>.pages.dev` | Pages custom domain |
| ~~Landing~~ | **Kapsam dışı** — WordPress sitesi yayında, dokunulmaz | — | — |

**Mevcut kullanım (çakışma haritası):**
| Subdomain | Durum |
|---|---|
| `nhtaxi.com` / `www` | WordPress landing — **dokunulmaz** |
| `app.nhtaxi.com` | Mevcut **Tracker** uygulaması — dolu (cutover sonrası, Faz 10, GNNcab Flutter Web'e devredilebilir) |
| `tracker.nhtaxi.com` | Mevcut **Tracker** uygulaması — dolu |
| `api.nhtaxi.com` | ✅ GNNcab API (yeni) |
| `admin.nhtaxi.com` | ✅ GNNcab web admin (yeni) |
| `preview.nhtaxi.com` | ✅ GNNcab Flutter Web önizleme (Faz 7, L32) |

**Kota notu (L30):** Cloudflare ücretsiz kotaları hesap genelindedir; aynı hesaptaki mevcut uygulamalarla paylaşılır. 20 sürücü ölçeğinde sorun beklenmez, yine de kullanım izlenir.

**Kurallar:**
- **Tek Worker** hem REST hem WebSocket'i karşılar → `wss://api.nhtaxi.com/ws`. Realtime için ayrı domain **gerekmez**.
- İsim kuralı: rol bazlı sade subdomain (`api`, `admin`). `gnncab-` öneki **kullanılmaz**; `api` ile `backend` aynı şeydir, ikisi ayrı host olmaz.
- **Mobil** → `api.nhtaxi.com`, Bearer token (CORS/cookie derdi yok).
- **Web admin** → farklı origin: auth cookie domain **`.nhtaxi.com`**, CORS allowlist `https://admin.nhtaxi.com`, CSRF korumalı.
- **DNS:** `nhtaxi.com` Cloudflare nameserver'larında olmalı; Universal SSL ücretsiz.
- **Ortamlar:** production = custom domain; PR = otomatik preview URL (DNS işi yok). Gerekirse ileride `api-staging` / `admin-staging` eklenir (ayrı D1 veritabanı ile).
- **Yapılandırma:** API taban URL'i ortama göre değişir → mobil build flavor (dev/prod), web admin env değişkeni.

### 13.7. Maliyet
GitHub Actions Free: private repo'da **2.000 dk/ay** (public sınırsız) — bu ölçekte fazlasıyla yeter. Cloudflare deploy ücretsiz. → **CI/CD de $0.**
