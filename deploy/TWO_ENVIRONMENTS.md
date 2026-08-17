# Dos lineas de producto: Produccion y Pruebas

Este proyecto usa dos ramas largas para separar el entorno estable del entorno
de desarrollo. Cada rama se despliega en un servidor distinto.

## Rama → Servidor

| Rama      | Servidor          | Objetivo                  | APP_ENVIRONMENT |
|-----------|-------------------|---------------------------|-----------------|
| `main`    | 47.87.38.52 (prod) | Uso real, datos reales    | `production`    |
| `develop` | servidor de test  | Pruebas de nuevas funciones | `test`       |

- En `main` solo entra codigo ya verificado en el servidor de pruebas.
- Toda funcionalidad nueva se desarrolla en ramas `feature/*` que se mezclan
  primero en `develop`; cuando se valida, se mezcla `develop` en `main`.
- Las dos instalaciones tienen **bases de datos PostgreSQL independientes**
  (volumenes Docker distintos), de modo que los datos de prueba nunca contaminan
  produccion.
- El servidor de pruebas muestra una franja naranja fija en la parte superior
  con el texto "ENTORNO DE PRUEBAS" para evitar confusion.

## Flujo de trabajo tipico

```bash
# 1. Crear una rama de funcion desde develop
git checkout develop
git pull origin develop
git checkout -b feature/nombre-funcion

# 2. Desarrollar, confirmar y subir
git add -A
git commit -m "feat: descripcion"
git push -u origin feature/nombre-funcion

# 3. Mezclar en develop y desplegar en el servidor de pruebas
git checkout develop
git merge --no-ff feature/nombre-funcion
git push origin develop
# En el servidor de pruebas:
cd /opt/sms-platform-test
git pull origin develop
docker compose up -d --build

# 4. Despues de validar, publicar en produccion
git checkout main
git merge --no-ff develop
git push origin main
# En el servidor de produccion:
cd /opt/sms-platform
git pull origin main
docker compose up -d --build
```

## Desplegar el servidor de PRUEBAS desde cero

En un servidor limpio (distinto al de produccion):

```bash
# Instalar Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Clonar y cambiar a la rama develop
mkdir -p /opt && cd /opt
git clone https://github.com/xuxin4788-akash/sms-platform.git sms-platform-test
cd sms-platform-test
git checkout develop

# Configurar variables de entorno (MARCADO COMO TEST)
cp .env.example .env
sed -i "s|your_secure_password_here|$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|generate_a_random_hex_string_here|$(openssl rand -hex 32)|" .env
sed -i "s|^APP_ENVIRONMENT=.*|APP_ENVIRONMENT=test|" .env

# Levantar
docker compose up -d --build
docker compose ps
```

Acceso: `http://IP_DEL_SERVIDOR_TEST/` → `admin` / `admin123` (cambiar la
contrasena tras el primer acceso).

## Desplegar/actualizar el servidor de PRODUCCION

```bash
cd /opt/sms-platform
git checkout main
git pull origin main
docker compose up -d --build
```

Produccion debe tener `APP_ENVIRONMENT=production` (o la variable sin definir,
que es el valor por defecto).

## Infraestructura recomendada

- Cada servidor corre sus propios contenedores `db`, `app`, `nginx` con un
  volumen `postgres-data` propio (se nombra segun el directorio:
  `sms-platform_postgres-data` vs `sms-platform-test_postgres-data`).
- Si los dos entornos llegaran a compartir maquina, usar directorios distintos
  y puertos externos distintos para Nginx (por ejemplo 80 y 8080), aunque lo
  recomendado es separarlos en maquinas diferentes.
- Backups independientes:
  ```bash
  docker compose -f /opt/sms-platform/docker-compose.yml exec db \
      pg_dump -U sms_user sms_platform > prod_$(date +%F).sql
  docker compose -f /opt/sms-platform-test/docker-compose.yml exec db \
      pg_dump -U sms_user sms_platform > test_$(date +%F).sql
  ```

## APK de Android

El APK apunta a una URL fija compilada en `mobile/capacitor.config.json`. Para
que el APK de prueba y el de produccion sean distintos y puedan coexistir en el
mismo telefono:

- **Produccion**: `applicationId com.smsmarketing.app`, `SMS_SERVER_URL` apunta
  al servidor de produccion; archivo `static/sms-marketing-production.apk`.
- **Pruebas**: generar con `applicationIdSuffix ".sandbox"` (ya configurado en
  el buildType `debug`), `SMS_SERVER_URL` apuntando al servidor de pruebas;
  archivo `static/sms-marketing-test.apk`.

Cada servidor publica su propio APK en `/static/` y lo sirve en su pagina de
descarga.
