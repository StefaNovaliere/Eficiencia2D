import UploadForm from "@/components/UploadForm";
import BackgroundSymbols from "@/components/BackgroundSymbols";
import { ThemePicker } from "@/context/ThemeContext";

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
      <ThemePicker />
      <BackgroundSymbols />
      
      <div className="text-center mb-12 mt-8 md:mt-12 z-10">
        <img
          src="/images/logoFaviconE2d.svg"
          alt="Eficiencia2D"
          width={128}
          height={128}
          className="mx-auto mb-6 w-24 h-24 md:w-32 md:h-32 drop-shadow-md"
        />
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 text-base-content">
          Eficiencia2D
        </h1>
        <p className="text-lg md:text-xl text-base-content/70 max-w-xl mx-auto font-medium">
          Convierte modelos 3D en planos arquitectónicos 2D al instante
        </p>
      </div>

      <div className="w-full max-w-3xl z-10">
        <UploadForm />
      </div>

      <footer className="mt-auto pt-12 pb-6 text-center z-10">
        <p className="text-sm text-base-content/60 leading-relaxed">
          Formato soportado: <code className="bg-base-300 px-1.5 py-0.5 rounded text-xs">.obj</code> &mdash;
          Tu archivo se procesa localmente en tu navegador.
        </p>
      </footer>
    </main>
  );
}
