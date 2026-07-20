# Yazılım Gereksinim Spesifikasyonu ve Sistem Mimarisi Dokümanı

## 1. PROJE ÖZETİ VE ÇEKİRDEK AMACI

GNNcab, birden fazla şehirde (multi-city) çalışan, gerçek zamanlı araç sevkiyatı (ride dispatch) ve sürücü takibi (driver tracking) sağlayan bir platformdur. Sistemin temel amacı; yolcuların seyahat taleplerini (trip requests) almak, konum ve uygunluk durumuna göre en ideal sürücüyü seçerek atamak, yolculuğun tüm durum geçişlerini gerçek zamanlı olarak hem sürücüye hem de yolcuya iletmek ve tüm bu süreçlerin ücretlendirme/rota hesaplamalarını yönetmektir.

Sistem; eşzamanlı websocket bağlantıları, coğrafi (spatial) mesafe algoritmaları, kuyruk mantığını simüle eden durum makineleri ve 3. parti harita/yönlendirme servisleri ile entegre çalışarak kesintisiz bir ulaşım ağı sağlar.

---

## 2. AKTÖR ANALİZİ VE YETKİLENDİRME (RBAC)

Sistemde yetkilendirme ve rol yönetimi JWT (JSON Web Token) tabanlıdır. Bağlantılar HTTP Cookie veya WebSocket Subprotocol (`auth.<token>`) üzerinden sağlanır. Sistemde üç ana aktör bulunmaktadır:

### 2.1. Aktörler ve Yaşam Döngüleri
- **Customer (Müşteri/Yolcu):** Sisteme e-posta ve şifre ile kaydolur. Seyahat talebi oluşturabilir, aktif seyahatinin durumunu izleyebilir ve sürücünün canlı konumunu (WebSocket üzerinden) takip edebilir.
- **Driver (Sürücü):** Standart `User` modeline ek olarak birebir (1:1) ilişkili bir `driver_profiles` kaydına sahiptir. Kendi durumunu (Offline, Available) güncelleyebilir, WebSocket üzerinden sürekli (`LOCATION_UPDATE`) konum basar ve kendisine atanan çağrıları kabul ya da reddedebilir.
- **Admin (Yönetici):** Tüm şehirlere, bölgelere (zones), sürücülere ve seyahat loglarına müdahale edebilir. Şehir ve bölge tanımlarını oluşturur, sürücüleri manuel olarak onaylar (`isVerified`) veya belirli bölgelere atayabilir.

### 2.2. Veri Modelleri ve Zorunlu Alanlar (Constraints)
- **`users` Tablosu:**
  - `id` (PK, UUID), `email` (Unique, Not Null), `passwordHash` (Not Null), `firstName` (Not Null), `lastName` (Not Null), `role` (Enum: `admin`, `driver`, `customer`), `isActive` (Boolean, Default: true).
- **`driver_profiles` Tablosu:**
  - `id` (PK, UUID), `userId` (Unique, FK -> `users.id`, OnDelete: Cascade).
  - Araç Detayları: `licenseNumber`, `vehicleMake`, `vehicleModel`, `vehicleYear`, `vehicleColor`, `vehiclePlate`.
  - Durum: `status` (Enum: `AVAILABLE`, `RESERVED`, `BUSY`, `OFFLINE`), `isVerified` (Boolean, Default: false).
  - Konum: `currentLat` (Float), `currentLng` (Float), `lastSeen` (Timestamp), `cityId` (FK -> `cities.id`).
  - İstatistik: `rating` (Numeric 3,2), `totalTrips` (Int, Default: 0).

---

## 3. FONKSİYONEL ÖZELLİKLER VE İŞ MANTIĞI (BUSINESS LOGIC)

### 3.1. Sürücü Seçim Algoritması (Dispatch Engine)
Müşteri bir seyahat talebi (`REQUESTED`) yarattığında dispatch algoritması tetiklenir:
1. **Filtreleme:** `status = 'AVAILABLE'` olan ve (varsa) talebin `cityId`'si ile eşleşen sürücüler veritabanından çekilir.
2. **Kuyruk ve Hariç Tutma:** Algoritma daha önce bu çağrıyı reddeden veya zaman aşımına uğratan sürücülerin listesini (`trip_events` üzerinden) kontrol eder ve bu ID'leri arama kümesinden çıkarır (`excludeDriverIds`).
3. **Mesafe Hesaplama:** Haversine formülü kullanılarak yolcunun alınacağı nokta (`pickupLat`, `pickupLng`) ile sürücülerin `currentLat`, `currentLng` değerleri arasındaki kuş uçuşu mesafe (mil cinsinden) hesaplanır.
4. **Önceliklendirme ve Kısıt:**
   - Maksimum arama yarıçapı (`MAX_DISPATCH_RADIUS_MILES`) **10 mil** olarak belirlenmiştir.
   - 10 mil içindeki en yakın sürücü seçilir.
5. **Kuyruk Yönetimi (Zaman Aşımı ve Tekrar Dağıtım):**
   - En yakın sürücü seçildiğinde, sürücü durumu `BUSY`, seyahat durumu `DRIVER_ASSIGNED` yapılır.
   - Sistemsel bir timer (`DISPATCH_TIMEOUT_MS = 60 saniye`) başlatılır.
   - Sürücü 60 saniye içinde yanıt vermezse, işlem geri alınır: Sürücü durumu `AVAILABLE`, seyahat durumu `DRIVER_NO_RESPONSE` olur.
   - Sistem otomatik olarak `tryRedispatch` fonksiyonunu çağırarak bir sonraki en yakın sürücüyü arar.
   - Maksimum yeniden dağıtım denemesi (`MAX_DISPATCH_ATTEMPTS`) **3**'tür. 3 deneme sonrasında eşleşme bulunamazsa çağrı durumu `TIMEOUT` olarak güncellenir.

### 3.2. Durum Makineleri (State Machines)
Sistemdeki tüm süreçler kesin durum geçişleri ile yönetilir:

**Seyahat (Trip) Durumları (`trip_status` Enum):**
- `REQUESTED` -> Başlangıç durumu. Algoritma eşleştirme için çalışıyor.
- `DRIVER_ASSIGNED` -> Algoritma bir sürücü buldu, sürücünün yanıtı bekleniyor.
- `DRIVER_ACCEPTED` -> Sürücü çağrıyı kabul etti.
- `DRIVER_REJECTED` -> Sürücü çağrıyı reddetti (Redispatch tetiklenir).
- `DRIVER_NO_RESPONSE` -> Sürücü 60 sn içinde dönmedi (Redispatch tetiklenir).
- `DRIVER_EN_ROUTE` -> Sürücü yolcuya doğru yola çıktı.
- `DRIVER_ARRIVED` -> Sürücü yolcunun konumuna ulaştı.
- `TRIP_STARTED` -> Yolcu araca bindi, seyahat başladı.
- `TRIP_COMPLETED` -> Hedefe ulaşıldı, seyahat bitti.
- `TRIP_CANCELLED` -> Müşteri veya sürücü tarafından seyahat iptal edildi.
- `TIMEOUT` -> Uygun sürücü bulunamadı veya maks deneme sayısına ulaşıldı.

**Sürücü Durumları (`driver_status` Enum):**
- `OFFLINE` -> Sürücü kapalı.
- `AVAILABLE` -> Sürücü açık, çağrı alabilir.
- `RESERVED` -> (Geçici/Kilit durumu - Startup/Cleanup süreçlerinde orphaned veriyi ayıklamak için kullanılıyor).
- `BUSY` -> Sürücüye çağrı atanmış (`DRIVER_ASSIGNED`) veya aktif bir seyahatte.

---

## 4. TEKNİK MİMARİ VE ENTEGRASYONLAR

### 4.1. Eşzamanlılık ve Gerçek Zamanlı İletişim (WebSocket & Pub/Sub)
- **Rate Limiting:** Sürücülerin gönderdiği canlı konumlar (`LOCATION_UPDATE`) WebSocket üzerinden sunucuya iletilir. Sunucu, her 60 saniyelik pencerede maksimum 30 güncelleme (`LOC_UPDATE_LIMIT`) sınırıyla Rate Limit uygular.
- **Yarış Koşulu (Race Condition) Koruması:** Atama (`assignDriverToTrip`) veya durum değiştirme işlemleri sırasında Drizzle ORM üzerinden **Database Transactions** kullanılır. Sürücü ve seyahat durumları tek bir transaction içinde bütünleşik (atomic) olarak güncellenir.
- **Yatay Ölçeklenebilirlik (Redis Pub/Sub):** WebSockets, Node.js process bellek bağımlılığından kurtarılmıştır. Bir sunucuya düşen mesaj veya lokasyon güncellemeleri, Redis aracılığıyla (`publish`/`subscribe`) diğer tüm instance'lara aktarılır. `CHANNEL_TRIP_UPDATE` ve `CHANNEL_DRIVER_LOCATION` kanalları kullanılarak multi-worker mimarisinde veri kaybı engellenir.

### 4.2. Arka Plan İşçileri ve Dayanıklılık (Startup Cleanup)
Harici bir kuyruk sistemi (örn. RabbitMQ, BullMQ) yerine, Node.js in-memory `setTimeout` blokları ve Process Restart Recovery algoritması (Dayanıklılık mekanizması) kurgulanmıştır. Sistem yeniden başlatıldığında (`startup.ts`):
- Bellekte kaybolmuş timer'lar sebebiyle havada kalan (`DRIVER_ASSIGNED`) seyahatleri tespit edip `DRIVER_NO_RESPONSE`'a çeker.
- `RESERVED` veya takılı kalan sürücü durumlarını `AVAILABLE`'a geri döndürür.
- Askıda kalmış `REQUESTED`, `DRIVER_REJECTED` veya `DRIVER_NO_RESPONSE` seyahatler için dispatch algoritmasını tekrar tetikleyerek sistemi tutarlı duruma (consistency) getirir.

### 4.3. Üçüncü Parti Entegrasyonlar
- **Rota ve Fiyatlandırma (OSRM):** Sistem, sürüş rotası tahmini ve ücret hesaplaması için **OSRM (Open Source Routing Machine)** entegrasyonu kullanır (`/route/v1/driving/{lng},{lat};{lng},{lat}`). Üretim (Production) ortamında OSRM zorunludur. Entegrasyon çökmesi (Timeout: 3000ms) veya dev ortamında sistem "Degraded Mode"a geçer ve rotayı Mock (Haversine üzerinden kuş uçuşu mesafe) kullanarak hesaplar. Taban fiyat $2.5, mil başı $1.2 formülü uygulanır.

---

## 5. VERİ TABANI ŞEMASI VE İLİŞKİLER

Veritabanı ilişkisel bir SQL (PostgreSQL) yapısıdır ve kritik indekslerle sorgu performansı garanti altına alınmıştır.

### 5.1. İlişkiler (ERD Logics)
- **`trips` Tablosu:**
  - `customerId` -> `users.id` (M:1)
  - `driverId` -> `driver_profiles.id` (M:1, Nullable, dispatcher tarafından atanır)
  - `cityId` -> `cities.id` (M:1)
- **`trip_events` Tablosu:**
  - Bir seyahatin geçtiği her durumu, atanan sürücüyü ve mesafe metadatalarını kronolojik olarak saklar. `tripId` -> `trips.id` (M:1, Cascade).
- **`zones` ve `driver_zones` (Opsiyonel / Admin):**
  - Yönetici sürücüleri belirli poligonal/bölgesel alanlara (`zones`) kısıtlayabilir. (M:N ilişki `driver_zones` tablosu ile tutulur).
- **`payments`:**
  - `tripId` -> `trips.id` (1:1 veya M:1). Ödeme durumları `cash`, `card`, `online` olarak Enum ile yönetilir.

### 5.2. Kritik İndeksleme (Indexing)
Sık sorgulanan alanlarda I/O darboğazını aşmak için eklenen indeksler:
- `idx_trips_customer_id`: Müşteri geçmişini listelemek için.
- `idx_trips_driver_id`: Sürücü görevlerini listelemek için.
- `idx_trips_status`: Startup Cleanup ve Dispatcher tarafından hızlı durum taraması için.
- `idx_driver_profiles_status`: `AVAILABLE` sürücüleri bulmak üzere dispatch algoritması tarafından yoğun şekilde kullanıldığından endekslenmiştir.
