import UploadForm from "@/components/UploadForm";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import StepIndicator from "@/components/StepIndicator";

export default function AppHomePage() {
  return (
    <main className="e2d-app-home flex flex-col min-h-screen items-center py-2 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="text-center mb-8 mt-4 md:mt-8 z-10">
        <img
          src="/images/logoFaviconE2d.svg"
          alt="Eficiencia2D"
          width={179}
          height={80}
          className="mx-auto mb-6 h-16 md:h-20 w-auto e2d-logo-glow"
        />
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 text-base-content e2d-title-glow">
          Eficiencia2D
        </h1>
        <p className="text-lg md:text-xl text-base-content/70 max-w-xl mx-auto font-medium">
          Convierte modelos 3D en planchas de corte al instante
        </p>
      </div>

      <div className="w-full max-w-4xl z-10">
        <div className="mb-6 px-2 max-w-md mx-auto">
          <StepIndicator current="upload" />
        </div>
        <UploadForm />
      </div>

      <footer className="mt-auto pt-12 pb-6 text-center z-10 space-y-1.5">
        <p className="text-sm text-base-content/60 leading-relaxed">
          Formato soportado: <code className="bg-base-300 px-1.5 py-0.5 rounded text-xs">.obj</code> &mdash;
          Subí una vez y seguí desde cualquier dispositivo con tu cuenta.
        </p>
        <p className="text-xs text-base-content/45">
          No necesitás cuenta para generar tus planos. Creá una solo si querés guardar tus proyectos y preferencias.
        </p>
      </footer>
    </main>
  );
}
