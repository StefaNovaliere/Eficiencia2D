import UploadForm from "@/components/UploadForm";

export default function Home() {
  return (
    <main className="main">
      <div className="hero">
        <div className="logo-mark">2D</div>
        <h1 className="title">Eficiencia2D</h1>
        <p className="subtitle">
          Convierte modelos 3D en planos arquitectónicos 2D al instante
        </p>
      </div>
      <UploadForm />
      <footer className="footer">
        <p>
          Formatos soportados: <code>.skp</code> <code>.obj</code> &mdash;
          Tu archivo se procesa y se elimina inmediatamente.
        </p>
      </footer>
    </main>
  );
}
