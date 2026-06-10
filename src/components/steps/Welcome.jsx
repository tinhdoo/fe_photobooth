import { useWorkflow } from '../../context/WorkflowContext';

const isVideoUrl = (url = '') => /\.(mp4|webm|mov)(\?|$)/i.test(url);

const Welcome = () => {
    const { nextStep, configs } = useWorkflow();
    const backgroundUrl = configs?.bg_welcome || '/1.png';

    return (
        <div
            className="relative flex h-full w-full cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#FFF8E7]"
            onClick={nextStep}
        >
            {isVideoUrl(backgroundUrl) ? (
                <video
                    src={backgroundUrl}
                    className="absolute inset-0 z-0 h-full w-full object-cover"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                />
            ) : (
                <div
                    className="absolute inset-0 z-0 bg-cover bg-center"
                    style={{ backgroundImage: `url('${backgroundUrl}')` }}
                />
            )}

        </div>
    );
};

export default Welcome;
