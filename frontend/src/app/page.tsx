import UploadForm from "@/components/UploadForm";

export default function Home() {
  return (
    <main className="main">
      <h1 className="title">Eficiencia2D</h1>
      <p className="subtitle">
        Upload a raw <code>.skp</code> file. Get dimensioned 2D plans instantly.
      </p>
      <UploadForm />
    </main>
  );
}
