import UploadForm from "@/components/UploadForm";
import BackgroundSymbols from "@/components/BackgroundSymbols";

export default function Home() {
  return (
    <main className="flex flex-col min-h-screen items-center py-12 px-4 md:px-8 relative">
      <BackgroundSymbols />
      
      <div className="text-center mb-12 mt-8 md:mt-12 z-10">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary text-primary-content text-2xl font-black rounded-2xl mb-6 shadow-xl shadow-primary/20">
          2D
        </div>
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
