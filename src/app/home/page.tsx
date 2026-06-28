import UploadForm from "@/components/UploadForm";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import StepIndicator from "@/components/StepIndicator";

export default function AppHomePage() {
  return (
    <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
      <BackgroundSymbols />

      <div className="text-center mb-8 mt-4 md:mt-8 z-10">
        <img
          src="/images/logoFaviconE2d.svg"
          alt="Eficiencia2D"
          width={128}
          height={128}
          className="mx-auto mb-6 w-24 h-24 md:w-32 md:h-32 e2d-logo-glow"
        />
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 text-base-content e2d-title-glow">
          Eficiencia2D
        </h1>
        <p className="text-lg md:text-xl text-base-content/70 max-w-xl mx-auto font-medium">
          Convierte modelos 3D en planos arquitectónicos 2D al instante
        </p>
      </div>

      <div className="w-full max-w-3xl z-10">
        <div className="mb-6 px-2 max-w-md mx-auto">
          <StepIndicator current="upload" />
        </div>
        <UploadForm />
      </div>

      <footer className="mt-auto pt-12 pb-6 text-center z-10 space-y-1.5">
        <p className="text-sm text-base-content/60 leading-relaxed">
          Formato soportado: <code className="bg-base-300 px-1.5 py-0.5 rounded text-xs">.obj</code> &mdash;
          Tu archivo se procesa localmente en tu navegador.
        </p>
        <p className="text-xs text-base-content/45">
          No necesitás cuenta para generar tus planos. Creá una solo si querés guardar tus proyectos y preferencias.
        </p>
      </footer>
    </main>
  );
}
