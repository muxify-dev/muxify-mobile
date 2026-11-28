Pod::Spec.new do |s|
  s.name = 'KeyboardSnapshot'
  s.version = '1.0.0'
  s.summary = 'Muxify keyboard snapshot: physical keyboard in use, and the software keyboard in the window'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Muxify'
  s.homepage = 'https://github.com/muxify-dev/muxify-mobile'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'GameController', 'UIKit'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
