# Eficiencia2D — Resumen de Proyecto

> Documento de contexto para iniciar conversaciones sobre estrategia, marketing y negocio en claude.ai. Pegalo al inicio de un chat nuevo.

---

## Qué es Eficiencia2D

Es una app web que convierte modelos 3D (archivos `.obj`) en **planos 2D listos para corte láser** (DXF + PDF). Está pensada para arquitectos, diseñadores, makers y estudios que trabajan con maquetas, prototipos y producción de piezas cortadas.

**Flujo del usuario:**

1. Sube un archivo `.obj` (export de SketchUp, Blender, Rhino, etc.)
2. La app clasifica automáticamente cada componente: pared, piso, techo, descartado
3. El usuario revisa la clasificación en un visor 3D interactivo y puede reclasificar manualmente
4. La app genera un "nesting" — acomoda todos los componentes en planchas estándar (configurable: tamaño, escala)
5. Vista previa de las planchas finales
6. **Pago de $30.000 ARS** (Mercado Pago) → descarga ZIP con DXF + PDF listos para enviar a la cortadora

**Tiempo total estimado por usuario: 2-5 minutos.**

---

## El problema que resuelve

Hoy, para llevar una maqueta de un modelo 3D a una cortadora láser, hace falta:

- Abrir el modelo en software CAD (AutoCAD, Rhino, etc.) — licencias caras, curva de aprendizaje alta
- Identificar manualmente cada superficie a cortar
- "Desplegar" las caras en 2D
- Acomodarlas a mano dentro del tamaño de plancha del cortador
- Exportar a DXF
- Iterar si no entra, si la escala es mala, etc.

Es un trabajo de **2-6 horas** dependiendo de la complejidad. Eficiencia2D lo hace en minutos.

---

## Validación

- **Test final aprobado**: el usuario llevó los PDFs generados a una imprenta/cortadora real y los cortes salieron bien. El producto funciona end-to-end con archivos reales.
- Soporta superficies inclinadas (techos), no solo paredes y pisos.
- Manejo de overrides: el usuario puede corregir la clasificación automática manteniendo los cambios entre pantallas.

---

## Modelo de Negocio

- **Precio fijo: $30.000 ARS por descarga** (≈ USD 25-30 a tipo de cambio actual, ajustable).
- **Sin login, sin cuentas, sin suscripciones.** Pago único anónimo por descarga.
- **Pago con Mercado Pago** (Checkout Pro): tarjeta de crédito/débito, transferencia, dinero en cuenta.
- Sin guardar datos del usuario en una DB — verificación de pago se hace contra la API de MP en el momento.
- **Código de bypass** privado para el dueño y testers (gratis), validado server-side.

**Consideraciones del modelo:**

- No hay costo recurrente por usuario.
- El costo marginal por descarga es prácticamente cero (procesamiento client-side, solo se paga hosting de Vercel + comisión MP ~4-6%).
- Margen estimado: ~$28.000 ARS por venta neta.

---

## Stack Técnico (breve)

- **Frontend**: Next.js 14 (App Router) + React + TypeScript
- **3D**: Three.js / react-three-fiber para el visor
- **Procesamiento**: 100% client-side (parser OBJ, clasificación geométrica, nesting, generación DXF/PDF) — la app no necesita backend pesado
- **Pagos**: Mercado Pago Checkout Pro (popup), verificación server-side via `mercadopago` SDK
- **Hosting**: Vercel (frontend + API routes serverless)
- **Sin base de datos.** Anonimato total.

---

## Estado Actual

- ✅ MVP completo y funcional
- ✅ Validado con cortes reales en imprenta
- ✅ Integración de pagos con Mercado Pago en producción
- ✅ Tests unitarios del flujo de pago (Vitest, 20 tests pasando)
- ✅ UI pulida (tema claro consistente, símbolos matemáticos flotantes en el fondo, branding cohesivo)
- ⏳ Falta: lanzamiento público, marketing, captación de primeros usuarios

---

## Audiencias potenciales

1. **Estudiantes de arquitectura y diseño industrial** — entregas de maquetas, presupuesto limitado, alto volumen
2. **Estudios de arquitectura** — maquetas de presentación a clientes
3. **Makers / hobbyistas** — proyectos personales, modelismo
4. **Pequeñas fábricas / carpinterías** — prototipos rápidos
5. **Imprentas y servicios de corte láser** — podrían ofrecer Eficiencia2D como servicio integrado o derivar clientes

---

## Diferenciales / Ventajas

- **Velocidad**: minutos vs. horas
- **No requiere software CAD ni licencias**
- **No requiere skills técnicos avanzados** — sube y descarga
- **Anonimato total** — sin cuentas, sin datos guardados
- **Precio fijo y claro** — sin suscripciones, sin sorpresas
- **Funciona en cualquier dispositivo con navegador**

---

## Preguntas abiertas para discutir en marketing

- Canal de adquisición: ¿Instagram/TikTok con demos visuales? ¿Comunidades de arquitectos en Facebook/Discord? ¿SEO sobre términos como "cortar maqueta laser"?
- Pricing: ¿$30.000 está bien? ¿Probar tiers (básico/premium)? ¿Descuentos por volumen para estudios?
- Partnerships con imprentas/servicios de corte láser locales
- Internacionalización: ¿abrir a otros mercados de habla hispana? ¿USD?
- Casos de uso secundarios que podrían escalar la utilidad
- Estrategia de contenido: tutoriales, antes/después, testimoniales

---

## Restricciones / Decisiones tomadas

- **No agregar login** — el anonimato es parte del valor
- **Procesamiento client-side** — privacidad de los modelos del usuario, escala infinita
- **Pago único, no suscripción** — uso esporádico esperado
- **Mercado Pago como único gateway por ahora** — foco en Argentina inicialmente
