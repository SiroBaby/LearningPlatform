package processing

import "fmt"

type CapabilityVersion string
type Transport string
type StructuredOutputMode string

const (
	ChatCompletionsJSONV1 CapabilityVersion = "chat-completions-json-v1"
	ResponsesJSONV1       CapabilityVersion = "responses-json-v1"

	ChatCompletions Transport = "chat-completions"
	Responses       Transport = "responses"

	JSONObject       StructuredOutputMode = "json-object"
	JSONSchemaStrict StructuredOutputMode = "json-schema-strict"
)

// ProviderProfile is the explicit provider contract; model aliases have no capability semantics.
type ProviderProfile struct {
	CapabilityVersion    CapabilityVersion
	StructuredOutputMode StructuredOutputMode
	Transport            Transport
}

func NewProviderProfile(capabilityVersion, transport, structuredOutputMode string) (ProviderProfile, error) {
	profile := ProviderProfile{
		CapabilityVersion:    CapabilityVersion(capabilityVersion),
		StructuredOutputMode: StructuredOutputMode(structuredOutputMode),
		Transport:            Transport(transport),
	}
	if profile.Transport != ChatCompletions && profile.Transport != Responses {
		return ProviderProfile{}, fmt.Errorf("OPENAI_TRANSPORT must be chat-completions or responses")
	}
	if profile.StructuredOutputMode != JSONObject && profile.StructuredOutputMode != JSONSchemaStrict {
		return ProviderProfile{}, fmt.Errorf("OPENAI_STRUCTURED_OUTPUT_MODE must be json-object or json-schema-strict")
	}
	if profile.CapabilityVersion != ChatCompletionsJSONV1 && profile.CapabilityVersion != ResponsesJSONV1 {
		return ProviderProfile{}, fmt.Errorf("OPENAI_CAPABILITY_VERSION must be chat-completions-json-v1 or responses-json-v1")
	}
	if (profile.CapabilityVersion == ChatCompletionsJSONV1 && profile.Transport != ChatCompletions) ||
		(profile.CapabilityVersion == ResponsesJSONV1 && profile.Transport != Responses) {
		return ProviderProfile{}, fmt.Errorf("OPENAI_CAPABILITY_VERSION must match OPENAI_TRANSPORT")
	}
	return profile, nil
}
