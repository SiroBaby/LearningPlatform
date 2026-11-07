package config

import (
	"testing"
	"time"
)

func mediaSTTEnvironment(overrides map[string]string) map[string]string {
	env := validEnvironment()
	env[mediaBucketEnvironment] = "media"
	env[fullPipelineMediaAccessKeyEnvironment] = "full-pipeline-access"
	env[fullPipelineMediaSecretKeyEnvironment] = "full-pipeline-secret"
	env[mediaSTTEnabledEnvironment] = "true"
	env[sttBaseURLEnvironment] = "https://9router.example/v1"
	env[sttAPIKeyEnvironment] = "stt-secret"
	env[sttModelEnvironment] = "groq/whisper-large-v3"
	for key, value := range overrides {
		if value == "" {
			delete(env, key)
			continue
		}
		env[key] = value
	}
	return env
}

func loadWithEnvironment(env map[string]string) (Config, error) {
	return Load(func(key string) (string, bool) { value, ok := env[key]; return value, ok })
}

func TestLoadKeepsMediaSTTOffAndUnreadByDefault(t *testing.T) {
	env := validEnvironment()
	// A stray STT_BASE_URL with the flag off must not be validated or loaded.
	env[sttBaseURLEnvironment] = "not a url"

	config, err := loadWithEnvironment(env)

	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if config.MediaSTT != (MediaSTT{}) {
		t.Fatalf("media STT = %#v, want disabled and empty", config.MediaSTT)
	}
}

func TestLoadEnablesMediaSTTWithSeparateConfiguration(t *testing.T) {
	config, err := loadWithEnvironment(mediaSTTEnvironment(nil))

	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	want := MediaSTT{Enabled: true, BaseURL: "https://9router.example/v1", APIKey: "stt-secret", Model: "groq/whisper-large-v3", Language: "vi", RequestTimeout: 2 * time.Minute, Concurrency: 3, GenerationConcurrency: 4}
	if config.MediaSTT != want {
		t.Fatalf("media STT = %#v, want %#v", config.MediaSTT, want)
	}
}

func TestLoadAppliesMediaSTTOverrides(t *testing.T) {
	config, err := loadWithEnvironment(mediaSTTEnvironment(map[string]string{
		sttLanguageEnvironment: "en", sttRequestTimeoutEnvironment: "45000", sttConcurrencyEnvironment: "5", mediaGenerationConcurrencyEnvironment: "2",
	}))

	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if config.MediaSTT.Language != "en" || config.MediaSTT.RequestTimeout != 45*time.Second || config.MediaSTT.Concurrency != 5 || config.MediaSTT.GenerationConcurrency != 2 {
		t.Fatalf("media STT = %#v", config.MediaSTT)
	}
}

func TestLoadRejectsInvalidMediaSTTConfiguration(t *testing.T) {
	tests := map[string]map[string]string{
		"flag is not a literal bool":        {mediaSTTEnabledEnvironment: "TRUE"},
		"missing base URL":                  {sttBaseURLEnvironment: ""},
		"missing API key":                   {sttAPIKeyEnvironment: ""},
		"missing model":                     {sttModelEnvironment: ""},
		"plain HTTP outside local override": {sttBaseURLEnvironment: "http://9router.example/v1", allowInsecureEndpointsEnvironment: "false"},
		"credentials in URL":                {sttBaseURLEnvironment: "https://user:pass@9router.example/v1"},
		"no media storage":                  {mediaBucketEnvironment: "", fullPipelineMediaAccessKeyEnvironment: "", fullPipelineMediaSecretKeyEnvironment: ""},
		"language is not an ISO code":       {sttLanguageEnvironment: "Vietnamese"},
		"timeout not a number":              {sttRequestTimeoutEnvironment: "soon"},
		"timeout at the job timeout":        {sttRequestTimeoutEnvironment: "200000", jobTimeoutEnvironment: "200000"},
		"timeout above the bound":           {sttRequestTimeoutEnvironment: "600000"},
		"concurrency zero":                  {sttConcurrencyEnvironment: "0"},
		"concurrency above the bound":       {sttConcurrencyEnvironment: "9"},
		"generation concurrency zero":       {mediaGenerationConcurrencyEnvironment: "0"},
	}
	for name, overrides := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := loadWithEnvironment(mediaSTTEnvironment(overrides)); err == nil {
				t.Fatal("Load() succeeded, want a configuration error")
			}
		})
	}
}

func TestLoadMediaProbeNeverSeesTheSTTFlagOrCredentials(t *testing.T) {
	config, err := loadMediaProbeWithAudioPrep(t, map[string]string{
		mediaSTTEnabledEnvironment: "true", sttAPIKeyEnvironment: "stt-secret", sttModelEnvironment: "model",
	})

	if err != nil {
		t.Fatalf("LoadMediaProbe() error = %v, want the STT variables ignored", err)
	}
	if config.MediaSTT != (MediaSTT{}) {
		t.Fatalf("probe media STT = %#v, want empty", config.MediaSTT)
	}
}
