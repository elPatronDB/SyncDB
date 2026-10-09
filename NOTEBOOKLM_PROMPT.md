# Paquete de Prompts y Contenido Maestro para NotebookLM
## Proyecto: SYNCDB
### Objetivo: Generar Presentación, Guiones de Video y Podcast Explicativo para Técnicos y No Expertos ("Mortales")

Copia y pega las siguientes secciones directamente en **NotebookLM** (como fuente de texto o en el chat) para obtener resúmenes ejecutivos, presentaciones de diapositivas, guiones de video para YouTube/TikTok/LinkedIn y el podcast generado por IA.

---

```markdown
================================================================================
PROMPT MAESTRO PARA NOTEBOOKLM (INSTRUCCIÓN DEL SISTEMA)
================================================================================
Actúa como un experto consultor acústico, divulgador de tecnología de audio profesional y diseñador de producto senior. 
Tienes la misión de analizar la documentación de "SYNCDB", un sistema revolucionario que convierte los smartphones del público en una red de sensores acústicos en tiempo real para calibrar recintos de conciertos y salas de conferencias sin micrófonos caros ni datos falsos.

Por favor, genera:
1. Una EXPLICACIÓN PARA MORTALES (personas sin conocimientos de física ni sonido) usando metáforas cotidianas, explicando el problema real, la solución de SYNCDB y por qué cambia las reglas del juego.
2. Un GUION DE VIDEO DE DEMOSTRACIÓN (3 a 5 minutos) estructurado paso a paso (Gancho, Problema, Demostración en Vivo con QR, Física del Clima, Calibración de 1 Botón y Conclusión).
3. Una ESTRUCTURA DE PRESENTACIÓN DE 10 DIAPOSITIVAS de alto impacto para inversores, directores de recintos y técnicos de audio.
4. Un ANÁLISIS TÉCNICO RIGUROSO para técnicos de sonido ("FOH Engineers" y diseñadores de sistemas) explicando:
   - Compensación de respuesta de frecuencia de micrófonos MEMS móviles (curva plana).
   - Variación de la velocidad del sonido por temperatura y humedad y su impacto en torres de delay y arreglos lineales (Line Array).
   - Promediado espacial multicelular frente a la medición puntual tradicional con micrófono RTA de 2.000 USD.
```

---

## 1. Documento Fuente Maestro para Cargar en NotebookLM

### Título del Producto: SYNCDB
**Eslogan:** *"La acústica del recinto calibrada por la misma audiencia que lo escucha."*

### El Problema en el Mundo Real
* **En el Sonido en Vivo Tradicional:** Un técnico de sonido llega a un auditorio vacío horas antes del evento. Coloca un único micrófono de medición costoso (como un Earthworks o Beyerdynamic) en el centro de la sala, emite ruido rosa (*pink noise*) y ecualiza el sistema para ese punto exacto.
* **El Desastre Ocurre Cuando Entra la Audiencia:**
  1. **El cuerpo humano absorbe sonido:** 500 personas sentadas absorben frecuencias medias y altas de forma masiva, alterando por completo la acústica de la sala vacía.
  2. **La temperatura y humedad aumentan drásticamente:** El calor corporal y la respiración calientan el aire y elevan la humedad. Como la velocidad del sonido cambia directamente con la temperatura (\(+0.6 \text{ m/s}\) por cada grado Celsius), los altavoces de refuerzo y las torres de retardo (*delay towers*) se desalinean temporalmente, provocando cancelaciones de fase severas y sonido "hueco" o "embarrado".
  3. **Medición ciega:** Durante el espectáculo, el técnico no puede caminar entre el público con un trípode y un cable de 50 metros para medir cómo se escucha en la fila 20 o en el balcón lateral.

### La Solución: SYNCDB
* **¿Qué hace la aplicación?**
  1. **Creación de Recintos Dinámica:** La aplicación inicia limpia permitiendo crear el recinto específico del evento (nombre, capacidad y características).
  2. La **Consola Master** del técnico proyecta el código QR del recinto.
  3. Los teléfonos de los asistentes o del equipo técnico escanean el QR y abren el **Modo Oyente** (una aplicación web PWA minimalista sin textos innecesarios).
  4. Cada teléfono móvil accede a su **micrófono real** y a su **GPS real**.
  5. Consulta la **API meteorológica en tiempo real (Open-Meteo)** usando sus coordenadas, calculando al milisegundo la temperatura, humedad y velocidad exacta del sonido en el recinto.
  6. Aplica un **algoritmo de aplanamiento de curva** al micrófono MEMS del teléfono (cancelando la pérdida natural en graves y la resonancia del puerto acústico) para que se comporte como un sensor acústico calibrado.
  7. Transmite paquetes FFT (espectro de frecuencias) vía WebSockets en tiempo real a la Consola Master.
  8. La Consola Master muestra en tiempo real el nivel en dBA (Ponderación A), el estado dinámico de calibración (PERFECTO, EXCELENTE, DESVIACIÓN ALTA) y, con **UN SOLO BOTÓN con icono ("CALIBRAR")**, calcula los filtros de ecualización paramétrica (PEQ) exactos para devolver la sala a una **curva de respuesta plana (0 dB)**.
  9. Guarda snapshots estructurados por día, hora y variables ambientales (temperatura, humedad, velocidad del sonido, dispositivos y filtros) por recinto para auditorías acústicas históricas.

---

## 2. Explicación para "Mortales" (Personas No Técnicas)

### La Metáfora del Aire Acondicionado en una Fiesta
> *"Imagina que quieres que la temperatura de una casa con 20 habitaciones sea perfecta durante una fiesta con 100 invitados.*  
> *El método antiguo es poner un solo termómetro en la sala principal antes de que llegue la gente. Pero cuando la fiesta empieza, la cocina se calienta por el horno, el balcón se enfría por el viento y el pasillo está lleno de gente sudando. El termómetro de la sala dice que todo está bien, pero la mitad de tus invitados se están asando.*  
> *SYNCDB es como si cada invitado tuviera un termómetro de bolsillo conectado por Wi-Fi. La casa entera sabe exactamente qué rincón tiene calor o frío y ajusta el clima de forma inteligente en tiempo real.*  
> *En sonido es idéntico: en lugar de adivinar cómo se escucha en el fondo del teatro, los teléfonos de la gente le dicen a la consola del ingeniero exactamente qué frecuencias faltan o sobran."*

### Los 3 Puntos Clave que Todo Mortal Entiende:
1. **No se graba voz ni conversaciones:** La app no graba audio a disco ni transmite palabras; solo mide niveles de energía matemática por bandas de frecuencia (espectro FFT).
2. **El calor cambia el sonido:** El sonido viaja más rápido en aire caliente que en aire frío. Cuando un auditorio se llena de gente, el sonido se acelera y los altavoces pierden sincronía. SYNCDB lo calcula automáticamente consultando el clima local en tiempo real.
3. **Calibración con 1 clic:** El ingeniero de sonido no tiene que pasar 40 minutos haciendo cálculos manuales; la app le dice exactamente: *"Baja 4 dB en 125 Hz y sube 3 dB en 4 kHz para que todos escuchen perfecto"*.

---

## 3. Guion de Video de Demostración (3 Minutos)

* **[0:00 - 0:25] Gancho Visual:**  
  *Primer plano a la Consola Master en pantalla oscura con estética de hardware Dieter Rams. Gráfica RTA en verde fósforo.*  
  *Voz:* "¿Sabías que cuando un concierto se llena de público, todo el sistema de sonido que tomó horas calibrar queda inmediatamente descalibrado? Hoy te muestro SYNCDB: la primera consola de calibración acústica distribuida que usa los propios teléfonos del público como micrófonos de medición en tiempo real."

* **[0:25 - 0:55] El Problema del Clima y la Velocidad del Sonido:**  
  *Cambio a la pestaña 'Estadísticas del Venue'. Se aprecia la temperatura (21.5°C), humedad (48%) y la velocidad del sonido (344.8 m/s).*  
  *Voz:* "El sonido no viaja siempre a la misma velocidad. Cuando el recinto se calienta por la audiencia, la velocidad del sonido sube 0.6 metros por segundo por cada grado de temperatura. Si no corriges el retardo milisegundo por milisegundo, los altavoces de refuerzo se desfasan y se pierde la claridad vocal. SYNCDB se conecta al GPS del móvil y a la API del clima en tiempo real para calcular la velocidad exacta y los milisegundos por metro."

* **[0:55 - 1:40] Demostración en Vivo con el Teléfono (Modo Oyente):**  
  *Aparece el código QR en pantalla. Se escanea con un smartphone. El móvil entra al Modo Oyente.*  
  *Voz:* "Escaneamos el QR del auditorio. El teléfono solicita permiso de micrófono y ubicación. Observa cómo la retícula acústica concéntrica reacciona inmediatamente a mi voz. Nada de datos falsos ni simulaciones: esto es un analizador FFT en tiempo real dentro del navegador. Y aquí tenemos algo crucial: el switch de 'Curva de Micrófono'. Los teléfonos móviles naturalmente cortan los graves por debajo de 80 Hz; nuestro algoritmo aplica una curva inversa que aplana la respuesta del micrófono del teléfono para igualar un micrófono de medición profesional."

* **[1:40 - 2:25] La Magia del 1-Click Auto-EQ en la Consola:**  
  *La cámara regresa a la Consola Master. Ahora vemos '1 NODO' y la línea verde fósforo dibujando la respuesta acústica real de la sala.*  
  *Voz:* "En la Consola Master vemos el nodo conectado transmitiendo a 25 cuadros por segundo. La línea verde muestra la señal capturada. La línea blanca punteada es el santo grial del sonido en vivo: la curva plana (0 dB). Ahora, con un solo botón: [CALIBRAR]. El motor de SYNCDB analiza las desviaciones espaciales, neutraliza los modos resonantes del auditorio y nos entrega la matriz de filtros paramétricos listos para copiar a nuestra consola digital: atenuación precisa en graves y compensación en medios."

* **[2:25 - 3:00] Cierre y Llamado a la Acción:**  
  *Voz:* "Un MVP 100% funcional, minimalista, sin botones inútiles ni adornos genéricos. Menos es más. SYNCDB: telemetría acústica de precisión en la palma de tu mano."

---

## 4. Estructura de Presentación (10 Diapositivas)

* **Slide 1: Portada:** SYNCDB // Calibración Acústica Distribuida en Tiempo Real.
* **Slide 2: El Dilema del Sonido en Vivo:** Por qué una sala vacía suena bien y una sala llena suena mal (absorción humana + gradiente térmico).
* **Slide 3: La Física del Retardo:** La velocidad del sonido como función directa de la temperatura (\(c \approx 331.4 + 0.606 \cdot T + 0.0124 \cdot HR\)).
* **Slide 4: El Concepto de Medición Distribuida:** Redes de sensores acústicos sin hardware propietario costoso.
* **Slide 5: Vinculación Instantánea vía QR:** Arquitectura PWA sin instalación en App Store, compatible con cualquier navegador móvil moderno.
* **Slide 6: Aplanamiento de Micrófonos Móviles:** Compensación de hardware MEMS mediante curva de transferencia inversa.
* **Slide 7: Telemetría Ambiental Automatizada:** Integración GPS + Open-Meteo API para cálculo dinámico de retardo por metro (\(\text{ms/m}\)).
* **Slide 8: Consola Master y Algoritmo Auto-EQ:** Promediado espacial y síntesis de ecualización paramétrica con 1 solo botón.
* **Slide 9: Persistencia y Base de Datos:** Historial de calibraciones y snapshots por día y hora para auditorías de recintos (JSON local + Firebase ready).
* **Slide 10: Conclusión & Futuro:** El nuevo estándar para teatros, auditorios y festivales masivos.
