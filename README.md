# CARXY 3D Studio

CARXY 3D Studio es un editor 3D en Angular con una capa social para compartir, descubrir y remixear modelos. El visor está construido con Three.js y requiere un navegador con soporte WebGL.

## Funciones

- Crear cubos, esferas, cilindros y toros, y combinarlos en una escena.
- Seleccionar, mover, rotar, escalar y eliminar objetos.
- Reemplazar el cubo de inicio al importar un modelo y explorar su jerarquía completa de grupos y mallas.
- Buscar piezas, seleccionarlas, enfocarlas y alternar su visibilidad individual.
- Importar modelos `.glb` y `.gltf`; exportar la escena completa a `.glb`.
- Editar color, rugosidad, metalicidad y opacidad de los materiales disponibles.
- Cambiar fondo, iluminación, exposición, cuadrícula, ejes, sombras, rotación de cámara y vistas ortográficas.
- Personalizar tema claro/oscuro, color de acento e idioma (español/inglés); los ajustes de apariencia también están disponibles desde el menú de cuenta en las páginas sociales y para visitantes.
- La barra del editor prioriza importar, publicar y exportar; las herramientas de cámara, captura, presentación, grabación y AR están agrupadas en el menú **Vista**. Las páginas sociales consumen las variables compartidas de superficie, texto, borde y acento para reflejar el tema y el color configurados.
- En anchos de hasta 1100 px, la navegación se mantiene en el menú **Espacio de trabajo** y las acciones del toolbar pueden ocupar una segunda fila; se evita el scroll horizontal que ocultaba el menú de perfil y recortaba los menús desplegables.
- Mensajes lista las conversaciones recientes con avatar, nombre, último mensaje y fecha. Firebase guarda el resumen en `/chats/{chatId}` y los mensajes en su subcolección; después de actualizar `firestore.rules`, despliega las reglas para permitir el acceso solo a participantes.
- Los portafolios consultan por `authorId` (con compatibilidad local para documentos antiguos que solo tienen `author.uid`); al cambiar índices, despliega `firestore.indexes.json` junto con las reglas.
- Notificaciones globales de éxito, error, advertencia e información, con posición configurable desde los ajustes del editor.
- Indicadores de carga accesibles y coherentes para navegación, feed, perfiles, paneles, conversaciones, acceso y publicación.
- Capturar el visor como imagen PNG.
- Feed comunitario responsive con alternancia entre miniatura e inspección 3D orbital, perfiles de creador con avatar/fallback, likes, comentarios en tiempo real y mensajería directa.
- Seguimiento de creadores con conteos de seguidores/seguidos y campana de actividad para follows, likes y comentarios; cada elemento puede marcarse leído.
- Publicar renders PNG junto con modelos GLB; abrir publicaciones en el editor para remixearlas.
- Panel de creaciones con métricas, edición de metadatos, privacidad y eliminación en cascada; administración de roles y moderación.
- Borradores de escena y preferencias del editor guardados localmente.
- Rutas standalone con carga diferida y protección para perfiles, chats, paneles de creaciones y administración.

En el menú de cuenta puedes abrir el perfil, acceder a tus creaciones, cambiar tema/color de acento y cerrar sesión. Si no has iniciado sesión, el menú conserva los ajustes visuales y muestra un acceso directo al login. En el feed, selecciona **Ver en 3D** para cargar el GLB de una publicación; arrastra para orbitar y usa la rueda para acercar o alejar. El visor se crea solo al solicitarlo para evitar inicializar WebGL en todas las tarjetas a la vez.

## Configurar Firebase

La app incluye un modo local de demostración y puede usar Firebase Authentication, Firestore y Storage cuando se configura el proyecto:

1. Crea una app web en Firebase Console y habilita Email/Password y Google en Authentication.
2. Crea Firestore y crea el bucket desde Firebase Console > Storage > Comenzar. Anota el nombre exacto del bucket; una respuesta 404 de la API de Storage normalmente indica que el bucket no existe o que el nombre configurado no coincide.
3. Copia la configuración de la app web en `public/firebase-config.js` y confirma que `storageBucket` coincide con el bucket creado. Son identificadores públicos del cliente; **no** pegues claves de cuentas de servicio.
4. Publica las reglas de `firestore.rules` y `storage.rules`, y los índices de `firestore.indexes.json` con Firebase CLI:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```

   El feed y los portafolios necesitan los índices compuestos definidos en `firestore.indexes.json`; si Firestore muestra “The query requires an index”, todavía no se han desplegado o creado.
5. Asigna el primer rol `admin` desde Firebase Console o una herramienta confiable con privilegios de servidor. El cliente no puede elevar su propio rol.

El perfil de creador es público; el chat, la gestión de diseños y las acciones de cuenta siguen requiriendo autenticación. La mensajería usa listeners en tiempo real de Firestore (`collectionData`), no un servidor WebSocket propio; en modo local los mensajes solo se sincronizan dentro de la instancia actual del navegador. Para habilitar follows y notificaciones en Firebase, despliega `firestore.rules` actualizado junto con los índices.

Las vistas previas y la descarga de modelos requieren que el bucket de Storage permita los orígenes web de la app. Si el navegador muestra `No 'Access-Control-Allow-Origin' header`, configura CORS en el bucket de Google Cloud Storage con `storage.cors.json` (Firebase CLI no despliega esta configuración):

```bash
gcloud auth login
gcloud config set project carxy-f3e27
gcloud storage buckets update gs://carxy-f3e27.firebasestorage.app --cors-file=storage.cors.json
```

El archivo permite el desarrollo en `localhost:4200`/`localhost:4202` y los dominios predeterminados de Firebase Hosting. Añade ahí el origen exacto de cualquier dominio personalizado antes de usarlo. Si la solicitud sigue fallando, revisa **Network**: un `404` suele indicar que el bucket o archivo no existe; un `403`, que las reglas/permisos lo rechazaron. CORS no crea el bucket ni concede acceso: `storage.rules` continúa controlando autenticación, propiedad y tamaño.

## Configuración, conexiones y secretos

- `src/environments/environment.ts` y `environment.production.ts` contienen configuración pública de la app (marca y límites de subida). La compilación de producción reemplaza automáticamente el archivo de desarrollo.
- `public/firebase-config.js` es la configuración de conexión del SDK web Firebase. `apiKey`, `projectId` y los demás campos del SDK identifican el proyecto; **no son tokens de servidor ni sustituyen las reglas de seguridad**.
- `src/app/core/config/app.constants.ts` centraliza rutas, colecciones, rutas de Storage y claves de almacenamiento local.
- Los límites de subida también están restringidos en `storage.rules`. Mantén los tamaños alineados entre configuración del cliente y reglas desplegadas; las reglas del servidor son la autoridad.
- Nunca pongas contraseñas, tokens privados, claves de cuentas de servicio, Stripe secret keys o secretos de webhook en `environment.ts`, `public/`, `localStorage` ni en el bundle Angular. Este repositorio no tiene actualmente backend de pagos/equipos; cuando se agregue, los secretos deben configurarse en el entorno del servidor/gestor de secretos, y el frontend solo debe llamar a endpoints autenticados.
- No se añadieron URLs de API ficticias ni variables de integración sin servicio implementado. Cuando exista un backend, configura su URL pública en el cliente y guarda sus credenciales exclusivamente en el backend.

Sin configuración, el acceso y los datos sociales funcionan en el navegador local para demostración. Ese modo no verifica contraseñas en un servidor, no comparte datos entre dispositivos y no debe usarse para cuentas reales. Con Firebase configurado, Auth, Firestore y Storage son requeridos para autenticación y publicaciones; los errores de Firebase se muestran al usuario.

Las reglas de Storage protegen las operaciones normales del SDK. Los enlaces de descarga de Firebase Storage contienen un token de acceso y deben tratarse como enlaces públicos una vez compartidos; al pasar un post de público a privado, una URL con token previamente expuesta puede seguir funcionando. Para confidencialidad real de archivos privados, usa un backend de confianza que entregue descargas autorizadas y revoque tokens. Los posts antiguos sin `isPrivate` también necesitan migrarse a `isPrivate: false` para aparecer en el feed.

## Pendientes conocidos

- La publicación en Firebase depende de que exista el bucket y coincida con `storageBucket`; el código puede probarse localmente, pero una publicación remota no se considera validada hasta completar una subida real.
- La moderación permite revisar y eliminar publicaciones, pero no hay todavía un flujo para reportarlas desde el feed ni una cola de reportes aunque esté reservado el nombre de colección `reports`.
- El feed no tiene todavía búsqueda, filtros ni paginación; conviene implementarlos antes de crecer la colección para limitar lecturas y tiempos de carga.
- No existe edición colaborativa multiusuario, invitación a espacios de trabajo ni historial compartido.
- Pagos, planes, suscripciones y contenido exclusivo no están habilitados. Antes de implementarlos hay que definir planes, moneda/país y reglas de propiedad; la autorización de equipos y cobros debe validarse en un backend, no en el cliente.
- Los tests actuales cubren servicios y componentes en local; no sustituyen pruebas de integración contra Firebase. Para validar reglas, índices y flujos remotos, configura y ejecuta Firebase Emulator Suite o un proyecto de staging con credenciales autorizadas.

## Desarrollo

Requiere Node.js y npm. Instala las dependencias y arranca el servidor:

```bash
npm install
npm start
```

`.npmrc` permite resolver las dependencias actuales porque AngularFire 20 todavía declara compatibilidad con Angular 20, mientras este proyecto usa Angular 22. La combinación se valida con el build y los tests del proyecto; elimina esta opción cuando AngularFire publique soporte oficial para la versión de Angular usada aquí.

Abre `http://localhost:4200/` en un navegador compatible con WebGL.

Las páginas disponibles son `/editor`, `/feed`, `/login`, `/register`, `/profile/:uid` y `/chat`. El chat directo requiere el UID del otro creador.

## Validación

```bash
npm run build
npm test -- --watch=false
```
