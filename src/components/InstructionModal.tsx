import React, { useState } from 'react';
import './InstructionModal.css';

interface InstructionModalProps {
  onClose: () => void;
}

const InstructionModal: React.FC<InstructionModalProps> = ({ onClose }) => {
  const [currentImage, setCurrentImage] = useState(0);
  const images = [
    '/instruction1.png',  // Локальное изображение в папке public
    '/instruction2.png'   // Локальное изображение в папке public
  ];

  const nextImage = () => {
    setCurrentImage((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setCurrentImage((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <div className="instruction-modal-overlay">
      <div className="instruction-modal">
        <button className="close-button" onClick={onClose}>
          ×
        </button>
        <div className="instruction-content">
          <img 
            src={images[currentImage]} 
            alt={`Инструкция ${currentImage + 1}`}
            className="instruction-image"
          />
        </div>
        <div className="navigation-buttons">
          <button 
            className="nav-button prev" 
            onClick={prevImage}
            disabled={currentImage === 0}
          >
            ←
          </button>
          <span className="image-counter">
            {currentImage + 1} / {images.length}
          </span>
          <button 
            className="nav-button next" 
            onClick={nextImage}
            disabled={currentImage === images.length - 1}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstructionModal; 