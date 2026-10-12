# Super Off Road · Remastered

Remake fan en 3D del arcade **Ivan "Ironman" Stewart's Super Off Road** (Leland, 1989), hecho con **Three.js r186** para jugar en el navegador del ordenador o del móvil.

Conserva lo que hacía divertido al original: cuatro camiones en un estadio de tierra vistos desde arriba, **4 vueltas** por carrera, saltos, baches, charcos, **nitros** y **bolsas de dinero** que aparecen en la pista, el camión gris de **Ironman** como rival a batir, los **créditos** que se pierden si la CPU te gana y el **taller** para mejorar el camión entre carreras. También trae lo que añadió el *Track Pak*: sus ocho circuitos y el **buggy** como alternativa al camión. Todo lo demás está rehecho: modelos 3D hechos con Blender, iluminación con sombras de día, al atardecer y de noche con focos, un estadio lleno de público, partículas, marcas de neumáticos que se acumulan durante la carrera, música, locutor y sonido sintetizado de los motores.

Y trae lo que hoy se espera de un juego de carreras: **cuatro niveles de dificultad** con rivales que pelean y se adaptan, **copas** con ceremonia de podio, **26 logros** y estadísticas, un **taller de pintura** con 14 acabados que se ganan, **contrarreloj con medallas** contra el fantasma de Ironman, un **desafío del día**, **lluvia** con pista mojada, un **tutorial** guiado, el campeonato **guardado** para seguirlo otro día (**CONTINUAR**), **dirección asistida** y control por **inclinación** en el móvil, **flechas y línea de carrera** en la pista, y al acabar cada carrera una **repetición con cámaras de televisión** (con un realizador automático que no se pierde un salto, a cámara lenta) y un **modo foto** para guardar o compartir la mejor imagen.

![Título](docs/titulo.png)
![Carrera](docs/carrera.png)
![Camión o buggy](docs/vehiculos.jpg)
![Volcano Valley](docs/volcan.jpg)

## Cómo jugarlo

Es una web estática: hay que servirla por HTTP (abrir `index.html` con doble clic no funciona, el navegador bloquea los módulos).

```bash
cd superoffroad
python3 tools/serve.py          # http://localhost:8080/  (y muestra la dirección para el móvil)
```

No hace falta instalar ni compilar nada: Three.js va incluido en `vendor/three/` y funciona sin conexión. `tools/serve.py` desactiva la caché y admite rangos HTTP (lo necesita Safari del iPhone para la música).

### Instalarlo como una aplicación

Publicado en una web con https (por ejemplo GitHub Pages), el juego **se instala como una app**: en Chrome para Android sale el botón **INSTALAR JUEGO** en el menú (o «Instalar aplicación» en el menú del navegador) y se abre a pantalla completa desde su icono. Después de abrirlo una vez **funciona sin conexión**: un *service worker* guarda los ficheros que usa (la música, la primera vez que suena). Con conexión siempre carga la versión más nueva. En el iPhone: *Compartir → Añadir a pantalla de inicio*.

El botón **atrás** de Android no te saca del juego: en carrera lo pone en pausa y en los menús vuelve a la pantalla anterior (en la pantalla de título, pulsándolo dos veces sí se sale).

### Subirlo a GitHub y jugar desde cualquier sitio

```bash
bash subir_a_github.sh
```

El script pregunta a qué repositorio subirlo (o crea uno nuevo, `super-off-road-remastered`), hace el commit con tu nombre y tu email, lo sube y ofrece publicarlo con **GitHub Pages**: el juego queda en `https://TU-USUARIO.github.io/super-off-road-remastered/`, listo para abrir en el móvil (en el iPhone, *Compartir → Añadir a pantalla de inicio* para jugar a pantalla completa). Todas las rutas del juego son relativas, así que funciona tal cual dentro de esa carpeta de GitHub Pages.

### Controles

| Acción | Teclado (1 jugador) | Mando | Táctil |
|---|---|---|---|
| Girar | ← → (o A D) | stick o cruceta | botones ◀ ▶ (o joystick) |
| Acelerar | ↑ (o W, X) | A / gatillo derecho | GAS |
| Frenar / marcha atrás | ↓ (o S, C) | B / gatillo izquierdo | — |
| Nitro | ESPACIO, ENTER o Z | X, Y, RB | NITRO (uno junto al gas y otro encima del giro) |
| Pausa | ESC o P | START | ❚❚ |
| Silenciar | M | | |

El giro es **rotacional**, como el volante del arcade: izquierda y derecha hacen girar el camión sobre sí mismo, mire hacia donde mire. En el móvil, la opción **Joystick** cambia a «apunta y acelera»: el camión va hacia donde empujas.

**En el móvil**: se juega en horizontal y a **pantalla completa** (se activa al tocar la pantalla de título y vuelve sola si sales de ella; se puede quitar en Opciones). En el iPhone, Safari no deja poner una web a pantalla completa: hay que usar **Compartir → Añadir a pantalla de inicio**, y desde ese icono el juego se abre sin barras. Los menús se ajustan solos al espacio que haya (con o sin barras del navegador), y los marcadores de la carrera se apartan (se vuelven casi transparentes) cuando un camión pasa por debajo.

En **Opciones** se puede poner el mando táctil para **zurdos** (giro a la derecha, gas y nitro a la izquierda), elegir el **tamaño de los botones** y dónde va el **botón de nitro**: hay dos, uno junto al gas y otro encima de las flechas de giro (para lanzarlo con el pulgar del giro sin soltar el gas); se pueden dejar **los dos** o solo uno (**en el gas** o **en el giro**).

**Tu camión** lleva encima una etiqueta **TÚ** (1P, 2P o 3P con varios jugadores) y un aro de su color en el suelo, que en la parrilla parpadea para que te encuentres. **Pellizca la pista** con dos dedos (o usa la rueda del ratón) para acercar o alejar la cámara: alejando del todo se pasa a la vista clásica de todo el estadio, y la cámara elegida se recuerda.

**Varios jugadores (2 o 3)** en el mismo teclado o con mandos: el jugador 1 usa las flechas + ENTER (nitro), el 2 usa W A S D + MAYÚS IZQUIERDA y el 3 usa I J K L + U. Cada mando conectado se asigna a un jugador.

### Primeros pasos

La primera vez que pulsas **1 JUGADOR**, el juego te ofrece el **tutorial**: una vuelta guiada en Fandango, solo en la pista, en la que cada paso se supera haciéndolo (acelerar, girar siguiendo las flechas, levantar el pie antes de una curva cerrada, el nitro, recoger una bolsa de dinero y terminar la vuelta). Los textos se adaptan al control que uses (táctil, teclado o mando) y en el móvil se ilumina el botón que toca. Se puede repetir desde **CÓMO SE JUEGA**.

### Reglas

- Cada carrera son **4 vueltas**. Premios: 1º **$100.000**, 2º $90.000, 3º $80.000, 4º $70.000, más las **bolsas de dinero** recogidas ($10.000–$50.000).
- Empiezas con **3 créditos** y **10 nitros**. Cuándo se pierde un crédito depende de la dificultad (ver abajo). Sin créditos se acaba la partida (puedes **continuar** con 3 créditos más). El dinero ganado es la puntuación de la tabla de récords, que muestra con qué dificultad se hizo cada una.
- La CPU ajusta su ritmo según cómo vas (el *Dynamic Play Adjustment* del original) y mejora sus camiones a medida que avanza el campeonato y al compás de tus propias mejoras: Ironman siempre va un poco mejor equipado que el resto, así que no basta con comprar para ganarle.
- El campeonato va por **copas de 4 carreras** (Copa del Polvo, del Barro, de los Saltos...): cada carrera da puntos a los cuatro pilotos (10, 6, 4 y 3) y los resultados muestran la clasificación de la copa. Al acabar la cuarta, los tres primeros suben a un **podio en 3D** (trofeo, confeti, chispas y la cámara acercándose al ganador) y los jugadores que suben cobran un premio: $150.000, $75.000 o $40.000, multiplicado como el resto de premios por la dificultad.
- Cuando alguien cruza la meta, el resto tiene 30 segundos para terminar.
- **Lluvia**: llueve en una de cada cinco carreras del campeonato (la 4ª, la 9ª, la 14ª...). La pista mojada agarra menos (unas décimas más lento por vuelta), el cielo se cubre, la tierra brilla con charcos donde caen las gotas, los camiones levantan agua en vez de polvo y, de vez en cuando, cae un relámpago seguido del trueno. En carrera libre se elige con **CLIMA**.
- Tu **mejor vuelta** en cada circuito y sentido queda como récord (se avisa en carrera cuando lo bates, y aparece en los resultados y en las tarjetas de CARRERA LIBRE).

### Partida guardada: CONTINUAR

El campeonato se guarda solo en el navegador a cada paso: antes de cada carrera, al terminarla y con cada compra en el taller. Si sales del juego (cierras el navegador o la app, el móvil lo cierra o eliges **GUARDAR Y SALIR** en la pausa, que en carrera libre sigue siendo SALIR AL TÍTULO), en el menú principal aparece **CONTINUAR**, el primero, con la copa, la carrera y la dificultad en que ibas:

- si lo dejaste **en mitad de una carrera**, esa carrera vuelve a empezar desde la parrilla (como REINICIAR CARRERA en la pausa), con el dinero y las mejoras que tenías al empezarla;
- si la carrera **ya había terminado**, cuenta (premio, puntos de la copa y créditos) y sigues en el **taller** con lo que hubieras comprado; si era la última de una copa, antes ves el **podio**, y si en ella perdiste el último crédito, pasas al fin de la partida.

Empezar un campeonato nuevo teniendo uno guardado pide confirmación antes de sustituirlo. Las carreras libres, las contrarrelojes, el desafío del día y el tutorial no lo tocan. Cuando se acaba la partida ya no hay nada que continuar (salvo que sigas con 3 créditos más en la pantalla de fin de partida).

### Dificultad

Al elegir 1, 2 o 3 jugadores se elige la dificultad del campeonato con cuatro fichas que explican lo que cambia (en **CARRERA LIBRE** se elige con **RIVALES**):

| Nivel | Los rivales | Pierdes un crédito | Premios |
|---|---|---|---|
| **Novato** | te esperan y fallan a menudo | si llegas el último | ×0,75 |
| **Piloto** (recomendado) | la experiencia clásica: te plantan cara y se adaptan a tu ritmo | si Ironman te gana | ×1 |
| **Experto** | afilados: casi no fallan, aprietan y guardan nitro para la última vuelta | si Ironman te gana | ×1,25 |
| **Arcade** | las reglas de la recreativa de 1989: implacables | si cualquier rival te gana | ×1,5 |

Cada nivel cambia de verdad cómo conducen los rivales, no solo su velocidad:

- **Pelean en las dos direcciones.** Un camión de la CPU que va por delante de ti levanta el pie (el ajuste dinámico del original). Uno al que le sacas más de 15 m conduce como un piloto mejor (frena más tarde, entra más rápido en las curvas, comete menos errores) y su motor rinde algo más. Una ventaja corta ganada a pulso se puede defender; una escapada se paga.
- **Su ritmo** desde la primera carrera y cuánto mejoran a lo largo del campeonato, los **errores** que cometen (frenar tarde y abrirse, dudar con el gas) y el **nitro** que guardan para la última vuelta.
- **En Novato y Piloto se adaptan a tu forma:** si ganas por mucho carrera tras carrera, los rivales se afilan; si pierdes por mucho, aflojan un poco. Las llegadas apretadas no cambian nada. Experto y Arcade son un reto fijo.

Los premios y las bolsas se multiplican según el nivel, y la puntuación con ellos.

Está calibrado con campeonatos simulados (`tools/test/difficulty.mjs`, 36 carreras por casilla) contra cuatro tipos de piloto, midiendo no solo quién gana sino **por cuánto**:

| Nivel | Bueno (teclado) | Medio (teclado) | Táctil con dirección asistida suave |
|---|---|---|---|
| Novato | gana todas, por ~5 s | gana el 94 % | gana el 78 % |
| Piloto | gana el 81 %, por ~1,7 s; la mitad de las llegadas por menos de 1,5 s | gana el 39 %; el 78 % de las llegadas por menos de 1,5 s | gana el 19 %; casi todas las llegadas apretadas |
| Experto | gana el 64 %, por ~1 s | gana el 19 % | — |
| Arcade | gana el 36 % | gana el 3 % | — |

Si un nivel se te queda corto (varias victorias seguidas) o grande (créditos perdidos carrera tras carrera), los resultados te sugieren cuál probar en la próxima partida.

### Dirección asistida

En **Opciones → DIRECCIÓN ASISTIDA** (viene en *suave* en el móvil y desactivada en el ordenador):

- **Suave**: si sueltas el giro, el camión sigue la pista un poco por sí solo, y si vas a chocar contra una valla corrige el volante hacia la trazada.
- **Fuerte**: sin tocar el giro el camión sigue la trazada, levanta el pie antes de las curvas que no pasaría y te aparta con más fuerza de las vallas.

Siempre manda el jugador: si giras para alejarte de la valla, o más fuerte en la buena dirección, la ayuda no te frena. Como en los juegos de carreras actuales, ayudar tiene un precio: los premios bajan un 10 % (suave) o un 20 % (fuerte) en las carreras en las que se usa. Con un jugador simulado torpe en pantalla táctil (reacciones tardías, el pulgar que se escapa del botón), la ayuda suave reduce los choques a menos de la mitad y la fuerte casi los elimina (`tools/test/assist.mjs`).

### Flechas en la pista y línea de carrera

Todos los circuitos llevan **flechas pintadas en el suelo** (grupos de tres chevrones en el centro del carril) que marcan el sentido de la carrera: se dan la vuelta en sentido inverso, hay una justo antes de cada cruce para indicar por dónde seguir, y nunca caen en charcos, rampas, baches ni en la parrilla. Están pintadas en el propio suelo, así que siguen el relieve, se ven igual de día y de noche y las rodadas las van desgastando durante la carrera.

La **línea de carrera** (Opciones → LÍNEA DE CARRERA, activada por defecto) dibuja chevrones sobre la trazada por delante de tu camión, como en los juegos de carreras actuales: **verde** donde puedes seguir acelerando, **ámbar** donde conviene levantar el pie y **roja** donde hay que frenar, según tu velocidad y la que admite cada curva con tu camión. Con varios jugadores en la misma pantalla no se muestra.

### Repetición con cámaras de televisión

Al acabar cada carrera (campeonato, carrera libre o contrarreloj), **VER REPETICIÓN** vuelve a poner la carrera entera como en la tele:

- Un **realizador automático** elige los planos: la parrilla de salida desde delante, cámaras en postes, helicóptero, cámaras a pie de pista, persecución y una cámara pegada al lateral del camión. Como la repetición sabe lo que va a pasar, corta a tiempo a los **saltos grandes** (que van **a cámara lenta**, con el sonido más grave), a los adelantamientos por los primeros puestos, a los choques y a la llegada a meta. Entre medias sigue sobre todo a tu camión.
- Controles: pausa, desde el principio, ±5 segundos, velocidad (×¼, ×½, ×1, ×2, ×4), **cámara** (AUTO, TV, PERSECUCIÓN, AÉREA, LATERAL, PISTA, CLÁSICA) y **camión** (todos o uno en concreto: con AUTO, el realizador solo busca los momentos de ese camión). La **línea de tiempo** marca las vueltas, los saltos grandes y la meta, y se puede tocar o arrastrar para saltar a cualquier momento. Los controles se ocultan solos: toca la pantalla para que vuelvan.
- Teclado: ← → y ENTER sobre los botones, ↑ ↓ camión, C cámara, V velocidad, F foto, R desde el principio, P pausa, ESC salir.

No es un vídeo: el juego guarda lo que pulsaste en cada instante (unos 30 KB por minuto) y vuelve a simular la carrera, que sale idéntica hasta el último decimal porque la simulación es determinista.

### Modo foto

En la repetición, el botón de la cámara de fotos congela la imagen: arrastra para girar alrededor del camión, pellizca (o la rueda del ratón) para acercar, elige el camión, el **objetivo** (gran angular, normal o tele) y un **filtro** (natural, blanco y negro, antigua o viva). **HACER FOTO** la guarda firmada con el logo, el circuito y la fecha; en el móvil se puede **compartir** directamente (WhatsApp, galería…) y en el ordenador se descarga como JPEG.

### Camión o buggy

Al elegir color se elige también el vehículo (↑ ↓ en el teclado o el mando, o tocando CAMIÓN / BUGGY), como en la recreativa con el *Track Pak*:

- **Camión**: más agarre y más velocidad punta. Es pesado, así que gana los empujones.
- **Buggy**: acelera más y tiene mejores amortiguadores (aterriza los saltos y pasa los baches sin perder el control). Es ligero y derrapa más, y los camiones lo apartan con facilidad. Suena distinto: un bóxer refrigerado por aire en vez del V8.

Con el mismo piloto los dos tardan casi lo mismo en el total de los 32 circuitos (diferencia por debajo del 0,5 %). El buggy gana en los circuitos de horquillas, agua y saltos (Huevos Grande, Rio Trio, Leapin' Lizards, Pig Bog) y el camión en los rápidos (Fandango, Redoubt About, Cutoff Pass).

### Contrarreloj con fantasma

En **CARRERA LIBRE → MODO: CONTRARRELOJ** corres solo, sin objetos en la pista, 3 vueltas. El juego graba tu recorrido y, la próxima vez que corras en ese circuito y sentido, un **fantasma** transparente de tu mejor tiempo corre contigo (también aparece en el minimapa). Al cerrar cada vuelta ves cuánto le sacas o te saca (en verde si vas por delante) y al final, tus vueltas, el tiempo total y si has batido el récord.

**Medallas.** En cada circuito y sentido, Ironman marca un tiempo con tu mismo vehículo y el mismo nivel de taller, y su **fantasma dorado** corre contigo desde la primera vez. **Oro** si le ganas; **plata** si quedas a menos del 5 % y **bronce** a menos del 12 %. El marcador muestra la siguiente medalla que te falta, la meta y los resultados la que has ganado y cuánto te faltó para la siguiente, y las tarjetas de los circuitos la mejor medalla y tu récord en cada uno. El tiempo de Ironman es una simulación determinista, el mismo en cualquier dispositivo; está calibrado para que un buen jugador saque oros y uno casual, bronces.

### Logros y estadísticas

En **LOGROS** (menú principal) están los 26 retos del juego, con barra de progreso los que se cuentan: ganar sin usar el nitro, terminar sin tocar las vallas, una remontada desde el último puesto en la última vuelta, un vuelo de 0,7 segundos, $100.000 en bolsas en una carrera, ganar con el buggy, de noche, en Experto o en Arcade, una copa, oros en la contrarreloj, los 16 circuitos, 100 km... Al conseguir uno aparece un aviso dorado. Arriba, las estadísticas: carreras, victorias, podios, kilómetros, saltos, el mejor vuelo, oros y la mejor partida.

### El taller de Ironman

Entre carreras se gasta el dinero en el taller (con el camión girando en la plataforma):

| Mejora | Efecto | Precio por nivel (5 niveles) |
|---|---|---|
| Neumáticos | más agarre y giro más rápido | $20.000 · $40.000 · $60.000 · $80.000 · $100.000 |
| Amortiguadores | aterrizajes y baches sin perder el control | ídem |
| Aceleración | sale disparado de las curvas | ídem |
| Velocidad punta | más velocidad en las rectas | ídem |
| Nitro | 1,6 s de empuje (máximo 99) | $5.000 cada uno |
| Cambiar crédito | como el *convert-a-credit* del arcade | +$200.000 por crédito |
| Pintura | 14 acabados (metalizado, mate, perlado, cromo) | se ganan con logros |

**Pintura**: el camión aparece en la plataforma con cada pintura según la eliges (Carbono, Inmaculado, Neón, Fuego, Medianoche, Millonario, Plata Ironman, Recreativa 1989, Mecánico, Oro, Campeón, Rayo, Espejo...). Las bloqueadas dicen con qué logro se ganan. La pintura se ve en la carrera, en el aro del suelo, en la etiqueta TÚ, en el marcador y en el podio, y se recuerda para las siguientes partidas.

### Desafío del día

**DESAFÍO DEL DÍA** (menú principal) es una contrarreloj distinta cada día, la misma para todo el mundo porque sale de la fecha: circuito, sentido, luz, a veces lluvia, el vehículo obligatorio y un giro (sin nitro, vuelta única, 5 vueltas o nitro a tope). Las medallas se miden contra Ironman en esas mismas condiciones (sus tiempos se calculan en segundo plano, sin parar el juego), la mejor vuelta del día queda como fantasma y se lleva la cuenta de los días seguidos con medalla.

### Los circuitos

Los **ocho circuitos de la recreativa** y los **ocho del *Track Pak*** (la ampliación que Leland sacó en 1989), adaptados a pantalla panorámica, en sentido normal e inverso: **32 configuraciones**, de día, al atardecer o de noche con focos. En el menú, **CIRCUITOS** elige qué entra en el campeonato (todos, solo los originales o solo el Track Pak) y **CARRERA LIBRE** deja correr una carrera suelta en el circuito, sentido y luz que quieras.

| Circuito | Lo que lo hace especial |
|---|---|
| **Fandango** | el ocho clásico con cruce en el centro, la colina, baches y un salto |
| **Huevos Grande** | la «W» de horquillas con charcos y los huevos gigantes en las rectas |
| **Sidewinder** | serpiente de cuatro rectas cruzada entera por una loma diagonal |
| **Big Dukes** | pirámides en la recta de arriba y el foso con agua en el centro |
| **Blaster** | la gran loma diagonal: cada cruce, con banderines, es un salto |
| **Hurricane Gulch** | espiral con cruce, el arroyo que baja hasta el ojo del huracán (de noche) |
| **Cliffhanger** | explanada abierta con la isla en zigzag, bidones gigantes y repisas para volar |
| **Wipeout** | ocho con un campo abierto de charcos y baches en el cruce (de noche) |
| *Track Pak* | |
| **Redoubt About** | la gran «C» y las eses con **curvas peraltadas** |
| **Rio Trio** | tres lagos y vados que cruzar salpicando (al atardecer) |
| **Leapin' Lizards** | saltos que aterrizan en charcos, la charca y tres lagartos gigantes tomando el sol en el centro |
| **Cutoff Pass** | la meseta: se sube, se baja por la «U» y se vuelve a subir |
| **Boulder Hill** | eslalon entre columnas de roca |
| **Pig Bog** | la ciénaga: campo abierto con canales de barro y los postes 1-2-3-4 (de noche) |
| **Shortcut** | la escalera de curvas sobre la repisa y los *whoops* de la izquierda |
| **Volcano Valley** | se sube por la falda del volcán, con su cráter humeante y ríos de lava que de noche brillan |

### Opciones

Calidad gráfica (Auto/Baja/Media/Alta, con resolución dinámica), cámara (**Clásica** como el arcade, **Dinámica** —misma vista pero más cerca, la que viene en el móvil— y **Persecución**; con estas dos aparece un minimapa del circuito), volumen de música y efectos, locutor, vibración (en el mando y en los móviles Android: golpes, aterrizajes duros y nitro), control táctil (**botones**, **joystick** o **inclinar** el móvil como un volante), **dirección asistida**, **línea de carrera**, acelerador automático y contador de FPS.

**Inclinar**: el giro sale del sensor de gravedad del móvil (vale para cualquier forma de sostenerlo en horizontal, en Android y en iPhone); la posición en la que lo sujetas en la salida es la de ir recto, se gira del todo a unos 24° y un pequeño temblor no cuenta. Quedan los botones de gas, freno y dos de nitro, y un indicador de inclinación abajo. El sensor solo se usa con INCLINAR elegido: CONTROL TÁCTIL abre un selector con los tres modos (no se va pasando por ellos al tocar) y el iPhone pide el permiso únicamente al tocar INCLINAR, nunca al abrir el juego. En la siguiente visita, si el iPhone aún lo recuerda, sigue funcionando sin preguntar; si lo ha olvidado, la carrera empieza con los botones y avisa de que hay que volver a elegirlo en Opciones. Sin sensor (un ordenador) también vuelve a los botones. Las opciones, los récords de puntuación y los de vuelta y el campeonato en curso se guardan en el navegador.

## Cómo está hecho

- `js/sim/`: la simulación, en JavaScript puro (sin Three.js), así que se puede probar en Node: generador de circuitos (campo de distancias para muros y colisiones, mapa de alturas con montículos, rampas, lomas, badenes y charcos, línea de carrera), física arcade del camión (agarre, derrapes, saltos con predicción balística, amortiguación, nitro, agua, choques), IA con perfil de velocidad que tiene en cuenta los saltos, y las reglas de la carrera.
- `js/render/`: terreno con texturas fotográficas y capa dinámica de rodadas, barreras extruidas a lo largo de los contornos, estadio con gradas de dos anillos, público animado (miles de sprites), torres de luz y videomarcador con imagen en directo, agua, atrezo, partículas y cámaras.
- `js/audio/`: motores sintetizados por cilindro (V8 para los camiones, bóxer de cuatro cilindros para el buggy) con cambio de marchas, derrapes, golpes, salpicaduras, nitro y ambiente de estadio, todo generado al cargar.
- `tools/blender/truck.py` construye el camión en **Blender 5.2** por script (carrocería, jaula, amortiguadores, barra de luces, ruedas con tacos y llantas *beadlock*, más una rueda de bajo detalle para la vista lejana), hornea la oclusión ambiental y exporta `assets/models/truck.glb`. `tools/blender/buggy.py` hace lo mismo con el buggy (morro de fibra, jaula tubular con techo, motor bóxer con escape, ruedas delanteras estrechas y traseras anchas). Los modelos se exportan con compresión *meshopt* (el decodificador va en `vendor/three/addons/libs/`). `tools/blender/props.py` hace el resto del atrezo (banderillero articulado, torre de salida, bidones gigantes, balas de paja, neumáticos, columnas de roca, lagartos gigantes, botella de nitro y saco de dinero). `tools/blender/logo.py` y `icon.py` renderizan el logotipo y el icono con Cycles.
- Repeticiones (`js/game/replay.js`, `director.js`, `replayview.js`): la entrada de cada jugador se redondea a lo que se guarda *antes* de que la simulación la use, así que lo grabado es exactamente lo que se corrió; la repetición es una simulación nueva con la misma semilla, los mismos coches y esas entradas. El realizador lee las notas de la grabación (saltos con su tiempo de vuelo, adelantamientos, choques, llegadas) y programa los planos y la cámara lenta. Las cámaras de pie de pista y lateral comprueban que no haya terreno ni vallas entre ellas y el camión. La dirección asistida (`js/sim/assist.js`) es una IA que no adelanta ni esquiva, solo aconseja la trazada, mezclada con lo que pulsa el jugador.
- Nuevos módulos: `js/game/career.js` (logros y estadísticas), `liveries.js` (pinturas), `daily.js` y `ironworker.js` (desafío del día; Ironman se simula en un *Web Worker*), `tutorial.js`, `js/render/podium.js` (la ceremonia). La lluvia es una opción de la carrera (`rain`: menos agarre, lo que también usa la IA para planificar) y en el render dos capas de gotas animadas en la GPU, el terreno mojado en su *shader* y los relámpagos.
- Robustez en el móvil: si el teléfono gira a vertical, se cambia de aplicación o el sistema recupera la memoria gráfica (pérdida del contexto WebGL), la carrera se pausa y el juego se recupera solo; la música usa un único reproductor para que el iPhone la deje cambiar de pista sin pedir otro toque.
- `tools/test/`: pruebas sin navegador (`simrace.mjs` corre carreras de la IA en los 16 circuitos, `season.mjs` juega un campeonato entero con las reglas reales contra un jugador simulado, `fuzz.mjs` somete la física a pilotos con mandos aleatorios, `vehiclebalance.mjs` compara camión y buggy con el mismo piloto, `simviz.mjs` dibuja trayectorias y choques, `keyboarddriver.mjs` simula a un jugador con teclado, `assist.mjs` mide la dirección asistida con un jugador torpe de pantalla táctil, `replaysim.mjs` comprueba que una repetición reproduce la carrera paso a paso, bit a bit, `difficulty.mjs` mide para cada nivel y tipo de jugador las victorias, los créditos perdidos y las distancias en meta, y `savegame.mjs` comprueba que un campeonato guardado y recuperado es el mismo —circuito, rivales, dinero, mejoras y copa— y que los datos dañados se rechazan), capturas (`shot.mjs`), un repaso visual de todas las pantallas a cualquier tamaño o modelo de móvil que avisa si algo no cabe o si un texto se sale de su botón (`screens.mjs`), pruebas del iPhone con el motor de Safari (`ios.mjs`: pellizco bloqueado en la página, zoom de cámara, aviso de pantalla de inicio, muesca), de girar el móvil y cambiar de aplicación (`rotate.mjs`) y de pérdida de la memoria gráfica (`ctxloss.mjs`), pruebas del flujo completo (`flow*.mjs`, incluida la contrarreloj con fantasma y medallas, los logros (`flow_career.mjs`), las copas y el podio (`flow_cup.mjs`), el taller de pintura (`flow_paint.mjs`), el desafío del día (`flow_daily.mjs`), el tutorial conducido por un bot con teclas reales (`flow_tutorial.mjs`), el control por inclinación con eventos del sensor y el permiso del iPhone, que solo se pide al elegirlo (`tilt.mjs`), CONTINUAR tras cerrar el juego en mitad de una carrera, en los resultados, en el taller y antes del podio (`flow_continue.mjs`) y `flow_replay.mjs`: una carrera conducida con teclas reales y la asistencia puesta, su repetición a ×4 que debe acabar con los mismos tiempos, el salto atrás, el modo foto y la vuelta a los resultados, en Chrome y en el motor de Safari), del modo sin conexión e instalable (`offline.mjs`), del botón atrás, el mando para zurdos y el efecto del nitro (`extras.mjs`), un «mono» que pulsa teclas al azar por todos los menús (`monkey.mjs`) y una prueba de fugas de memoria (`leak.mjs`).

## Versiones

La versión sale en pequeño abajo a la derecha de la pantalla de título y del menú principal; está en `js/version.js` y cada mejora la sube una centésima. Así se ve de un vistazo si el móvil o la app instalada ya tienen la última.

- **v0.68** (12/10/2026): **CONTINUAR** en el menú principal (el campeonato se guarda solo y se puede seguir tras salir del juego) y la versión en pantalla. Además, los motores, la lluvia y el público de la carrera ya no siguen sonando en el taller ni en el podio.

## Créditos y licencias

- Juego original: *Ivan "Ironman" Stewart's Super Off Road* © 1989 Leland Corporation. Este remake es un proyecto de aficionado sin ánimo de lucro; los nombres y marcas pertenecen a sus dueños.
- Música de **Kevin MacLeod** ([incompetech.com](https://incompetech.com)), licencia [Creative Commons Atribución 4.0](http://creativecommons.org/licenses/by/4.0/): «Hotrock», «Exhilarate», «Cool Rock», «Ready Aim Fire», «Neolith» y «Twisted».
- Texturas de tierra de [Poly Haven](https://polyhaven.com) (CC0): *Red Dirt Mud 01*, *Red Laterite Soil Stones*, *Brown Mud 03*.
- Fuentes **Russo One** y **Teko** (SIL Open Font License, en `fonts/`).
- Voz del locutor generada con [Piper](https://github.com/rhasspy/piper) (voz *en_US-ryan-high*): los nombres de los 16 circuitos y los avisos de carrera («Into the lead!», «Ironman takes the lead!», «Big air!», «Wrong way!», «Lap record!», «Time trial!»…).
- Three.js (licencia MIT, en `vendor/three/`) y el decodificador de [meshoptimizer](https://github.com/zeux/meshoptimizer) (licencia MIT).
