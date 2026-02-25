import UploadForm from "@/components/UploadForm";

export default function Home() {
  return (
    <main className="main">
      <h1 className="title">Eficiencia2D</h1>
      <p className="subtitle">
        Sube tu archivo <code>.skp</code> o <code>.obj</code> y obtén planos
        2D acotados al instante.
      </p>
      <p className="privacy-note">
        100% en el navegador — tu archivo nunca sale de tu máquina.
      </p>
      <UploadForm />
    </main>
  );
}
